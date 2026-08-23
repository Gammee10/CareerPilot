// Resume artifact intake (T3.1 / FR-2 / ADR-050). Objects live outside
// PostgreSQL; only metadata is recorded. All access flows through
// short-lived, single-use, scoped grants — never direct object URLs.
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import type { ObjectStore } from "../storage/objectStore.js";
import { generateToken, hashToken } from "../identity/tokens.js";
import { recordAudit } from "../identity/audit.js";

const MINUTE_MS = 60 * 1000;
export const UPLOAD_GRANT_TTL_MINUTES = 10;
export const DOWNLOAD_GRANT_TTL_MINUTES = 5;
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES = new Set([
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export type GrantResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "resume_not_found" | "not_owned" };

export async function createUploadGrant(
  db: Pool,
  accountId: string,
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + UPLOAD_GRANT_TTL_MINUTES * MINUTE_MS);
  await db.query(
    `INSERT INTO resume_upload_grants (account_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, 'upload', $3)`,
    [accountId, hashToken(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function createDownloadGrant(
  db: Pool,
  accountId: string,
  resumeDocumentId: string,
  now: Date
): Promise<GrantResult> {
  const doc = await db.query<{ account_id: string }>(
    "SELECT account_id FROM resume_documents WHERE id = $1",
    [resumeDocumentId]
  );
  if (doc.rows.length === 0) return { ok: false, reason: "resume_not_found" };
  if (doc.rows[0].account_id !== accountId) return { ok: false, reason: "not_owned" };

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + DOWNLOAD_GRANT_TTL_MINUTES * MINUTE_MS);
  await db.query(
    `INSERT INTO resume_upload_grants (account_id, token_hash, purpose, resume_document_id, expires_at)
     VALUES ($1, $2, 'download', $3, $4)`,
    [accountId, hashToken(token), resumeDocumentId, expiresAt]
  );
  return { ok: true, token, expiresAt };
}

export type UploadResult =
  | { ok: true; resumeDocumentId: string }
  | { ok: false; reason: "invalid_grant" | "unsupported_type" | "too_large" };

export async function completeUpload(
  db: Pool,
  store: ObjectStore,
  grantToken: string,
  body: Buffer,
  contentType: string,
  now: Date
): Promise<UploadResult> {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, reason: "unsupported_type" };
  }
  if (body.byteLength > MAX_RESUME_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Atomic single-use claim of the grant.
    const grant = await client.query<{ id: string; account_id: string }>(
      `UPDATE resume_upload_grants SET used_at = $2
        WHERE token_hash = $1 AND purpose = 'upload'
          AND used_at IS NULL AND expires_at > $2
        RETURNING id, account_id`,
      [hashToken(grantToken), now]
    );
    if (grant.rows.length !== 1) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_grant" };
    }
    const accountId = grant.rows[0].account_id;

    // Internal storage key; never exposed externally, never sent to AI.
    const objectKey = `resumes/${randomBytes(16).toString("hex")}`;
    await store.put(objectKey, body, contentType);

    const sha256 = createHash("sha256").update(body).digest("hex");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO resume_documents
         (account_id, storage_key, sha256, byte_size, content_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [accountId, objectKey, sha256, body.byteLength, contentType]
    );
    await recordAudit(client, {
      actorType: "user",
      actorAccountId: accountId,
      action: "resume.uploaded",
      outcome: "success",
      targetCategory: "resume_document",
      targetId: inserted.rows[0].id
    });
    await client.query("COMMIT");
    return { ok: true, resumeDocumentId: inserted.rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type DownloadResult =
  | { ok: true; body: Buffer; contentType: string; documentId: string }
  | { ok: false; reason: "invalid_grant" };

export async function downloadWithGrant(
  db: Pool,
  store: ObjectStore,
  grantToken: string,
  now: Date
): Promise<DownloadResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const grant = await client.query<{ id: string; resume_document_id: string }>(
      `UPDATE resume_upload_grants SET used_at = $2
        WHERE token_hash = $1 AND purpose = 'download'
          AND used_at IS NULL AND expires_at > $2
          AND resume_document_id IS NOT NULL
        RETURNING id, resume_document_id`,
      [hashToken(grantToken), now]
    );
    if (grant.rows.length !== 1) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_grant" };
    }
    const doc = await client.query<{ storage_key: string; content_type: string | null }>(
      "SELECT storage_key, content_type FROM resume_documents WHERE id = $1",
      [grant.rows[0].resume_document_id]
    );
    await recordAudit(client, {
      actorType: "capability",
      action: "resume.downloaded",
      outcome: "success",
      targetCategory: "resume_document",
      targetId: grant.rows[0].resume_document_id
    });
    await client.query("COMMIT");

    const object = await store.get(doc.rows[0].storage_key);
    if (!object) return { ok: false, reason: "invalid_grant" };
    return {
      ok: true,
      body: object.body,
      contentType: object.contentType,
      documentId: grant.rows[0].resume_document_id
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
