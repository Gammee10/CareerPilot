// Resume extraction work unit (T3.2). Idempotent per ADR-045: the same
// logical input (document + content hash) yields at most one persisted
// outcome. Durable pg-boss delivery arrives in T5.1; this function is the
// work unit that delivery will invoke, with identical semantics.
import type { Pool } from "pg";
import type { ObjectStore } from "../storage/objectStore.js";
import type { AiClient } from "./aiClient.js";
import { buildExtractionTask, taskContentHash } from "./minimization.js";
import { validateProposal } from "./proposal.js";
import { recordAudit } from "../identity/audit.js";

export type ExtractionOutcome =
  | { ok: true; draftId: string; reusedExisting: boolean }
  | { ok: false; reason: "document_not_found" | "unsupported_type" | "ai_unavailable" | "malformed_output" };

export async function runExtraction(
  db: Pool,
  store: ObjectStore,
  ai: AiClient,
  resumeDocumentId: string,
  _now: Date
): Promise<ExtractionOutcome> {
  const doc = await db.query<{
    account_id: string;
    storage_key: string;
    content_type: string;
    sha256: string | null;
  }>(
    "SELECT account_id, storage_key, content_type, sha256 FROM resume_documents WHERE id = $1",
    [resumeDocumentId]
  );
  if (doc.rows.length === 0) return { ok: false, reason: "document_not_found" };
  const document = doc.rows[0];
  if (document.content_type !== "text/plain") {
    return { ok: false, reason: "unsupported_type" };
  }

  // Only text is sent onward; the raw file never leaves CareerPilot (ADR-054).
  const object = await store.get(document.storage_key);
  if (!object) return { ok: false, reason: "document_not_found" };

  const hints = await knownIdentityHints(db, document.account_id);
  let task;
  try {
    task = buildExtractionTask(object.body.toString("utf8"), hints);
  } catch {
    await recordAudit(db, {
      actorType: "capability",
      action: "extraction.failed",
      outcome: "failure",
      targetCategory: "resume_document",
      targetId: resumeDocumentId,
      details: { stage: "minimization" }
    });
    return { ok: false, reason: "ai_unavailable" };
  }
  const idempotencyKey = `extraction:${resumeDocumentId}:${taskContentHash(task)}`;

  const existing = await db.query(
    "SELECT idempotency_key FROM idempotency_records WHERE idempotency_key = $1",
    [idempotencyKey]
  );
  if (existing.rows.length > 0) {
    const priorDraft = await db.query<{ id: string }>(
      `SELECT id FROM resume_extraction_drafts
        WHERE resume_document_id = $1 AND status <> 'discarded'
        ORDER BY created_at DESC LIMIT 1`,
      [resumeDocumentId]
    );
    if (priorDraft.rows.length > 0) {
      return { ok: true, draftId: priorDraft.rows[0].id, reusedExisting: true };
    }
  }

  let proposalRaw: unknown;
  try {
    proposalRaw = await ai.requestExtraction(task);
  } catch {
    await recordAudit(db, {
      actorType: "capability",
      action: "extraction.failed",
      outcome: "failure",
      targetCategory: "resume_document",
      targetId: resumeDocumentId,
      details: { stage: "provider_unavailable" }
    });
    return { ok: false, reason: "ai_unavailable" };
  }

  const validated = validateProposal(proposalRaw);
  if (!validated.ok) {
    // Malformed AI output is rejected without persistence (ADR-029/054).
    await recordAudit(db, {
      actorType: "capability",
      action: "extraction.rejected_malformed",
      outcome: "failure",
      targetCategory: "resume_document",
      targetId: resumeDocumentId,
      details: { reason: validated.reason }
    });
    return { ok: false, reason: "malformed_output" };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const draft = await client.query<{ id: string }>(
      `INSERT INTO resume_extraction_drafts
         (account_id, resume_document_id, proposed_content, status)
       VALUES ($1, $2, $3, 'ready') RETURNING id`,
      [document.account_id, resumeDocumentId, JSON.stringify(validated.proposal)]
    );
    await client.query(
      `INSERT INTO idempotency_records (idempotency_key, work_type, outcome)
       VALUES ($1, 'resume_extraction', $2)`,
      [idempotencyKey, JSON.stringify({ draftId: draft.rows[0].id })]
    );
    await recordAudit(client, {
      actorType: "capability",
      actorAccountId: document.account_id,
      action: "extraction.draft_created",
      outcome: "success",
      targetCategory: "extraction_draft",
      targetId: draft.rows[0].id
    });
    await client.query("COMMIT");
    return { ok: true, draftId: draft.rows[0].id, reusedExisting: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function knownIdentityHints(db: Pool, accountId: string): Promise<{
  knownEmails: string[];
  knownNames: string[];
  knownAccountIds: string[];
}> {
  const row = await db.query<{ email: string }>(
    "SELECT email::text AS email FROM accounts WHERE id = $1",
    [accountId]
  );
  return {
    knownEmails: row.rows[0] ? [row.rows[0].email] : [],
    knownNames: [],
    knownAccountIds: [accountId]
  };
}
