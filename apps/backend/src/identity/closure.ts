// Disclosure acknowledgements (T7.4, FR-0a/ADR-035) and account closure
// with fresh purpose-bound confirmation (T7.5, FR-0b/ADR-036).
import type { Pool } from "pg";
import { generateToken, hashToken } from "./tokens.js";
import { recordAudit } from "./audit.js";
import { closeAccount } from "./accounts.js";
import { config } from "../config.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Disclosures
// ---------------------------------------------------------------------------

export async function hasAcknowledged(
  db: Pool,
  accountId: string,
  disclosureKey: string
): Promise<boolean> {
  const row = await db.query(
    `SELECT 1 FROM disclosure_acknowledgements WHERE account_id = $1 AND disclosure_key = $2`,
    [accountId, disclosureKey]
  );
  return row.rows.length > 0;
}

export async function acknowledgeDisclosure(
  db: Pool,
  accountId: string,
  disclosureKey: string,
  now: Date
): Promise<void> {
  await db.query(
    `INSERT INTO disclosure_acknowledgements (account_id, disclosure_key, acknowledged_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, disclosure_key) DO NOTHING`,
    [accountId, disclosureKey, now]
  );
  await recordAudit(db, {
    actorType: "user",
    actorAccountId: accountId,
    action: "disclosure.acknowledged",
    outcome: "success",
    targetCategory: "disclosure",
    details: { disclosureKey }
  });
}

// ---------------------------------------------------------------------------
// Closure (FR-0b / ADR-036): request -> FRESH purpose-bound link ->
// explicit redemption closes the account immediately.
// ---------------------------------------------------------------------------

export async function requestClosureConfirmation(
  db: Pool,
  accountId: string,
  now: Date
): Promise<{ token: string; expiresAt: Date } | { error: "account_closed" }> {
  const acct = await db.query<{ state: string }>(
    "SELECT state FROM accounts WHERE id = $1 FOR UPDATE",
    [accountId]
  );
  if (acct.rows[0]?.state === "closed") return { error: "account_closed" };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // A new confirmation link invalidates prior unused ones (ADR-018 rule).
    await client.query(
      `UPDATE signin_links SET invalidated_at = $2
        WHERE account_id = $1 AND purpose = 'closure_confirm'
          AND redeemed_at IS NULL AND invalidated_at IS NULL`,
      [accountId, now]
    );
    const token = generateToken();
    const expiresAt = new Date(now.getTime() + config.identity.signinLinkTtlMinutes * MINUTE_MS);
    await client.query(
      `INSERT INTO signin_links (account_id, email, token_hash, purpose, issued_at, expires_at)
       SELECT id, email, $2, 'closure_confirm', $3, $4 FROM accounts WHERE id = $1`,
      [accountId, hashToken(token), now, expiresAt]
    );
    await recordAudit(client, {
      actorType: "user",
      actorAccountId: accountId,
      action: "closure.confirmation_requested",
      outcome: "success",
      targetCategory: "account",
      targetId: accountId
    });
    await client.query("COMMIT");
    return { token, expiresAt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type ClosureRedeemResult =
  | { ok: true }
  | { ok: false }; // non-disclosing: invalid/expired/reused/unconfirmed links

export async function redeemClosureConfirmation(
  db: Pool,
  token: string,
  now: Date
): Promise<ClosureRedeemResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const link = await client.query<{ id: string; account_id: string }>(
      `UPDATE signin_links SET redeemed_at = $2
        WHERE token_hash = $1 AND purpose = 'closure_confirm'
          AND confirmed_at IS NOT NULL
          AND redeemed_at IS NULL AND invalidated_at IS NULL
          AND expires_at > $2
        RETURNING id, account_id`,
      [hashToken(token), now]
    );
    if (link.rows.length !== 1) {
      await client.query("ROLLBACK");
      return { ok: false };
    }
    await client.query("COMMIT");

    // Immediate access + work block via the state machine (revokes sessions).
    const result = await closeAccount(db, link.rows[0].account_id, link.rows[0].account_id, now, {
      reason: "owner_confirmed_closure_via_fresh_link"
    });
    if (!result.ok) return { ok: false };
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Truthful deletion-status info (FR-0b). */
export async function closureStatus(
  db: Pool,
  accountId: string
): Promise<{
  closed: boolean;
  deletionDeadline: string | null;
}> {
  const row = await db.query<{ state: string; closed_at: Date | null }>(
    "SELECT state, closed_at FROM accounts WHERE id = $1",
    [accountId]
  );
  if (row.rows[0]?.state === "closed" && row.rows[0].closed_at) {
    return {
      closed: true,
      deletionDeadline: new Date(row.rows[0].closed_at.getTime() + 30 * DAY_MS).toISOString()
    };
  }
  return { closed: false, deletionDeadline: null };
}

export async function confirmClosureLink(
  db: Pool,
  token: string,
  now: Date
): Promise<boolean> {
  const updated = await db.query(
    `UPDATE signin_links SET confirmed_at = $2
      WHERE token_hash = $1 AND purpose = 'closure_confirm'
        AND redeemed_at IS NULL AND invalidated_at IS NULL AND expires_at > $2`,
    [hashToken(token), now]
  );
  return updated.rowCount === 1;
}
