// Extraction draft review workflow (T3.3 / FR-2). A draft is never
// authoritative: edits touch only the draft; a profile version is created
// exclusively on explicit acceptance.
import type { Pool, PoolClient } from "pg";
import { validateProposal, type ProfileProposal } from "./proposal.js";
import { recordAudit } from "../identity/audit.js";

export type DraftRow = {
  id: string;
  account_id: string;
  resume_document_id: string | null;
  proposed_content: ProfileProposal;
  status: "pending" | "ready" | "accepted" | "discarded";
};

export async function listDrafts(db: Pool, accountId: string): Promise<DraftRow[]> {
  const rows = await db.query<DraftRow>(
    `SELECT id, account_id, resume_document_id, proposed_content, status
       FROM resume_extraction_drafts
      WHERE account_id = $1 AND status IN ('ready','accepted')
      ORDER BY created_at DESC`,
    [accountId]
  );
  return rows.rows;
}

export async function getOwnedDraft(
  db: Pool | PoolClient,
  accountId: string,
  draftId: string
): Promise<DraftRow | null> {
  const rows = await db.query<DraftRow>(
    `SELECT id, account_id, resume_document_id, proposed_content, status
       FROM resume_extraction_drafts WHERE id = $1 AND account_id = $2`,
    [draftId, accountId]
  );
  return rows.rows[0] ?? null;
}

export async function editDraft(
  db: Pool,
  accountId: string,
  draftId: string,
  editedProposal: unknown,
  now: Date
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_editable" | "invalid_proposal" }> {
  const draft = await getOwnedDraft(db, accountId, draftId);
  if (!draft) return { ok: false, reason: "not_found" };
  if (draft.status !== "ready") return { ok: false, reason: "not_editable" };

  // User edits are validated with the same strictness as AI output — the
  // draft feeds a profile version later and must remain well-formed.
  const validated = validateProposal(editedProposal);
  if (!validated.ok) return { ok: false, reason: "invalid_proposal" };

  await db.query(
    `UPDATE resume_extraction_drafts SET proposed_content = $3, updated_at = $4
      WHERE id = $1 AND account_id = $2 AND status = 'ready'`,
    [draftId, accountId, JSON.stringify(validated.proposal), now]
  );
  return { ok: true };
}

export type AcceptResult =
  | { ok: true; profileVersionId: string; versionNumber: number }
  | { ok: false; reason: "not_found" | "not_editable" | "invalid_proposal" };

export async function acceptDraft(
  db: Pool,
  accountId: string,
  draftId: string,
  now: Date
): Promise<AcceptResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const draft = await getOwnedDraft(client, accountId, draftId);
    if (!draft) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (draft.status !== "ready") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_editable" };
    }
    const validated = validateProposal(draft.proposed_content);
    if (!validated.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_proposal" };
    }

    // Save happens under the same lock so version numbering is consistent.
    const maxRow = await client.query<{ max_version: number | null }>(
      "SELECT MAX(version_number) AS max_version FROM profile_versions WHERE account_id = $1",
      [accountId]
    );
    const nextVersion = (maxRow.rows[0].max_version ?? 0) + 1;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO profile_versions (account_id, version_number, source, content)
       VALUES ($1, $2, 'extraction_draft', $3) RETURNING id`,
      [accountId, nextVersion, JSON.stringify(validated.proposal)]
    );
    const versionId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO career_profiles (account_id, current_profile_version_id, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id)
       DO UPDATE SET current_profile_version_id = $2, updated_at = $3`,
      [accountId, versionId, now]
    );
    await client.query(
      `UPDATE resume_extraction_drafts
          SET status = 'accepted', accepted_profile_version_id = $2, updated_at = $3
        WHERE id = $1`,
      [draftId, versionId, now]
    );
    await recordAudit(client, {
      actorType: "user",
      actorAccountId: accountId,
      action: "profile.saved",
      outcome: "success",
      targetCategory: "profile_version",
      targetId: versionId,
      details: { version_number: nextVersion, source: "extraction_draft", draft_id: draftId }
    });
    await client.query("COMMIT");
    return { ok: true, profileVersionId: versionId, versionNumber: nextVersion };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function discardDraft(
  db: Pool,
  accountId: string,
  draftId: string,
  now: Date
): Promise<boolean> {
  const updated = await db.query(
    `UPDATE resume_extraction_drafts SET status = 'discarded', updated_at = $3
      WHERE id = $1 AND account_id = $2 AND status = 'ready'`,
    [draftId, accountId, now]
  );
  return (updated.rowCount ?? 0) === 1;
}
