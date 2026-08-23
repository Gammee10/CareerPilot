// Invitation lifecycle (ADR-025 states; ADR-026 validity; FR-0).
import type { Pool, PoolClient } from "pg";
import { recordAudit } from "./audit.js";
import { generateToken, hashToken } from "./tokens.js";
import { config } from "../config.js";

export type InvitationRow = {
  id: string;
  email: string;
  status: "issued" | "accepted" | "expired" | "revoked";
  issued_at: Date;
  expires_at: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type IssueResult =
  | { ok: true; invitationId: string; token: string; expiresAt: Date }
  // rejected: the email already has an active account, or an unexpired
  // issued invitation already exists (revoke before re-issuing).
  | { ok: false; reason: "already_active" | "pending_exists" };

export async function issueInvitation(
  db: Pool,
  email: string,
  adminAccountId: string,
  now: Date
): Promise<IssueResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const acct = await client.query<{ state: string }>(
      "SELECT state FROM accounts WHERE email = $1",
      [email]
    );
    if (acct.rows[0]?.state === "active") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_active" };
    }

    const pending = await client.query<{ id: string }>(
      `SELECT id FROM invitations
        WHERE email = $1 AND status = 'issued' AND expires_at > $2`,
      [email, now]
    );
    if (pending.rows.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "pending_exists" };
    }

    const token = generateToken();
    const expiresAt = new Date(now.getTime() + config.identity.invitationTtlDays * DAY_MS);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO invitations (email, token_hash, status, invited_by_account_id, expires_at)
       VALUES ($1, $2, 'issued', $3, $4) RETURNING id`,
      [email, hashToken(token), adminAccountId, expiresAt]
    );
    const invitationId = inserted.rows[0].id;

    await recordAudit(client, {
      actorType: "admin",
      actorAccountId: adminAccountId,
      action: "invitation.issued",
      outcome: "success",
      targetCategory: "invitation",
      targetId: invitationId
    });
    await client.query("COMMIT");
    return { ok: true, invitationId, token, expiresAt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeInvitation(
  db: Pool,
  invitationId: string,
  adminAccountId: string,
  now: Date
): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE invitations SET status = 'revoked', revoked_at = $2
        WHERE id = $1 AND status = 'issued' RETURNING email`,
      [invitationId, now]
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await recordAudit(client, {
      actorType: "admin",
      actorAccountId: adminAccountId,
      action: "invitation.revoked",
      outcome: "success",
      targetCategory: "invitation",
      targetId: invitationId
    });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Lazily expire issued-but-past-expiry invitations so status is truthful.
export async function expireStaleInvitations(
  db: Pool | PoolClient,
  now: Date
): Promise<void> {
  const stale = await db.query(
    `UPDATE invitations SET status = 'expired'
      WHERE status = 'issued' AND expires_at <= $1
      RETURNING id`,
    [now]
  );
  for (const row of stale.rows) {
    await recordAudit(db, {
      actorType: "system",
      action: "invitation.expired",
      outcome: "success",
      targetCategory: "invitation",
      targetId: row.id as string
    });
  }
}

export type AcceptResult =
  | { ok: true; accountId: string }
  | // Non-disclosing: callers collapse every failure into one generic response.
  { ok: false; reason: "invalid_token" | "not_active_state" };

export async function acceptInvitation(
  db: Pool,
  token: string,
  now: Date
): Promise<AcceptResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await expireStaleInvitations(client, now);

    const inv = await client.query<InvitationRow & { token_hash: string }>(
      `SELECT id, email::text AS email, status, token_hash, issued_at, expires_at
         FROM invitations WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(token)]
    );
    const row = inv.rows[0];
    if (!row || row.status !== "issued") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_token" };
    }

    // Idempotent account creation: an existing active account for this email
    // simply signs in again (re-issued/expired-then-reaccepted path).
    let accountId: string;
    const acct = await client.query<{ id: string; state: string }>(
      "SELECT id, state FROM accounts WHERE email = $1 FOR UPDATE",
      [row.email]
    );
    if (acct.rows[0]) {
      if (acct.rows[0].state === "closed") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "invalid_token" }; // closed is terminal (ADR-025)
      }
      accountId = acct.rows[0].id;
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO accounts (email, state) VALUES ($1, 'active') RETURNING id`,
        [row.email]
      );
      accountId = created.rows[0].id;
      await recordAudit(client, {
        actorType: "user",
        actorAccountId: accountId,
        action: "account.activated",
        outcome: "success",
        targetCategory: "account",
        targetId: accountId
      });
    }

    await client.query(
      `UPDATE invitations SET status = 'accepted', accepted_at = $2 WHERE id = $1`,
      [row.id, now]
    );
    await recordAudit(client, {
      actorType: "user",
      actorAccountId: accountId,
      action: "invitation.accepted",
      outcome: "success",
      targetCategory: "invitation",
      targetId: row.id
    });
    await client.query("COMMIT");
    return { ok: true, accountId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
