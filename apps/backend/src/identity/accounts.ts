// Account state machine (ADR-025): active <-> suspended; closed is terminal.
import type { Pool, PoolClient } from "pg";
import { recordAudit } from "./audit.js";

export type AccountRow = {
  id: string;
  email: string;
  state: "active" | "suspended" | "closed";
  is_admin: boolean;
  created_at: Date;
};

export async function findAccountByEmail(
  db: Pool,
  email: string
): Promise<AccountRow | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT id, email::text AS email, state, is_admin, created_at
       FROM accounts WHERE email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findAccountById(
  db: Pool,
  id: string
): Promise<AccountRow | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT id, email::text AS email, state, is_admin, created_at
       FROM accounts WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export type StateChangeResult =
  | { ok: true; account: AccountRow }
  | { ok: false; reason: "not_found" | "invalid_transition" };

async function setState(
  db: Pool,
  accountId: string,
  next: "active" | "suspended" | "closed",
  allowedFrom: string[],
  actorAccountId: string,
  action: string,
  now: Date,
  extraDetails?: Record<string, unknown>,
  // Join an existing transaction (H3 atomic redemption) instead of opening
  // one. The caller owns COMMIT/ROLLBACK; failure audits still persist via
  // the pool outside the caller's transaction.
  outer?: PoolClient
): Promise<StateChangeResult> {
  const client = outer ?? (await db.connect());
  const owned = outer === undefined;
  try {
    if (owned) await client.query("BEGIN");
    const { rows } = await client.query<{ state: AccountRow["state"] }>(
      "SELECT state FROM accounts WHERE id = $1 FOR UPDATE",
      [accountId]
    );
    if (rows.length === 0) {
      if (owned) await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (!allowedFrom.includes(rows[0].state)) {
      if (owned) await client.query("ROLLBACK");
      // Failure evidence must persist — recorded outside the aborted transaction.
      await recordAudit(db, {
        actorType: "admin",
        actorAccountId,
        action,
        outcome: "failure",
        targetCategory: "account",
        targetId: accountId,
        details: { reason: "invalid_transition", from: rows[0].state }
      });
      return { ok: false, reason: "invalid_transition" };
    }

    // Timestamps reflect the CURRENT state exactly (schema CHECK equality);
    // historical transition times remain in audit events.
    const updated = await client.query<AccountRow>(
      `UPDATE accounts
          SET state = $2,
              updated_at = $3::timestamptz,
              closed_at = CASE WHEN $2 = 'closed' THEN $3::timestamptz ELSE NULL END,
              suspended_at = CASE WHEN $2 = 'suspended' THEN $3::timestamptz ELSE NULL END
        WHERE id = $1
        RETURNING id, email::text AS email, state, is_admin, created_at`,
      [accountId, next, now]
    );

    // ADR-027: suspension/closure ends all sessions immediately.
    if (next !== "active") {
      await client.query(
        "UPDATE sessions SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL",
        [accountId, now]
      );
    }

    await recordAudit(client, {
      actorType: "admin",
      actorAccountId,
      action,
      outcome: "success",
      targetCategory: "account",
      targetId: accountId,
      details: { to: next, ...extraDetails }
    });
    if (owned) await client.query("COMMIT");
    return { ok: true, account: updated.rows[0] };
  } catch (err) {
    if (owned) await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    if (owned) client.release();
  }
}

export function suspendAccount(
  db: Pool,
  accountId: string,
  actorAccountId: string,
  now: Date,
  details?: Record<string, unknown>
) {
  return setState(db, accountId, "suspended", ["active"], actorAccountId,
    "account.suspended", now, details);
}

export function restoreAccount(
  db: Pool,
  accountId: string,
  actorAccountId: string,
  now: Date
) {
  return setState(db, accountId, "active", ["suspended"], actorAccountId,
    "account.restored", now);
}

// Closure is terminal (ADR-025); it starts the bounded deletion lifecycle.
export function closeAccount(
  db: Pool,
  accountId: string,
  actorAccountId: string,
  now: Date,
  details?: Record<string, unknown>,
  outer?: PoolClient
) {
  return setState(db, accountId, "closed", ["active", "suspended"], actorAccountId,
    "account.closed", now, details, outer);
}
