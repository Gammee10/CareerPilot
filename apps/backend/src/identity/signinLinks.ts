// Passwordless sign-in links (ADR-018/026): opaque, single-use,
// confirmation-before-redemption, 15-minute validity, issuance limits
// (3 per 15 min / 10 per 24 h per email), prior-unused invalidation.
import type { Pool } from "pg";
import { recordAudit } from "./audit.js";
import { generateToken, hashToken } from "./tokens.js";
import { config } from "../config.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type RequestResult =
  | { ok: true; token: string; expiresAt: Date }
  // "suppressed" covers rate-limited AND unknown-email requests; callers
  // return the identical generic response either way (non-disclosing).
  | { ok: false; reason: "suppressed" };

export type RequestPolicy = {
  ttlMinutes?: number;
  maxPer15Min?: number;
  maxPer24H?: number;
};

export async function requestSignInLink(
  db: Pool,
  email: string,
  now: Date,
  policy?: RequestPolicy
): Promise<RequestResult> {
  const account = await db.query<{ id: string; state: string }>(
    "SELECT id, state FROM accounts WHERE email = $1",
    [email]
  );
  const row = account.rows[0];
  // Unknown email or non-active account: respond as if nothing happened.
  if (!row || row.state !== "active") {
    await recordAudit(db, {
      actorType: "system",
      action: "signin_link.requested",
      outcome: "denied",
      targetCategory: "signin_link"
    });
    return { ok: false, reason: "suppressed" };
  }

  const recent15 = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM signin_links
      WHERE email = $1 AND issued_at > $2`,
    [email, new Date(now.getTime() - 15 * MINUTE_MS)]
  );
  const recent24 = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM signin_links
      WHERE email = $1 AND issued_at > $2`,
    [email, new Date(now.getTime() - 24 * HOUR_MS)]
  );
  const max15 = policy?.maxPer15Min ?? config.identity.signinLinkMaxPer15Min;
  const max24 = policy?.maxPer24H ?? config.identity.signinLinkMaxPer24H;
  if (Number(recent15.rows[0].n) >= max15 || Number(recent24.rows[0].n) >= max24) {
    await recordAudit(db, {
      actorType: "system",
      action: "signin_link.requested",
      outcome: "denied",
      targetCategory: "signin_link",
      details: { reason: "rate_limited" }
    });
    return { ok: false, reason: "suppressed" };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Issuing a new link invalidates the prior unused link (ADR-018).
    await client.query(
      `UPDATE signin_links SET invalidated_at = $2
        WHERE account_id = $1 AND redeemed_at IS NULL AND invalidated_at IS NULL`,
      [row.id, now]
    );
    const token = generateToken();
    const expiresAt = new Date(
      now.getTime() + (policy?.ttlMinutes ?? config.identity.signinLinkTtlMinutes) * MINUTE_MS
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO signin_links (account_id, email, token_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [row.id, email, hashToken(token), now, expiresAt]
    );
    await recordAudit(client, {
      actorType: "system",
      action: "signin_link.issued",
      outcome: "success",
      targetCategory: "signin_link",
      targetId: inserted.rows[0].id
    });
    await client.query("COMMIT");
    return { ok: true, token, expiresAt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Step 1 of redemption: confirm intent. Never authenticates or consumes
// the link (ADR-018 confirmation-before-redemption).
export async function confirmSignInLink(
  db: Pool,
  token: string,
  now: Date
): Promise<boolean> {
  const updated = await db.query(
    `UPDATE signin_links SET confirmed_at = $2
      WHERE token_hash = $1 AND redeemed_at IS NULL AND invalidated_at IS NULL
        AND expires_at > $2`,
    [hashToken(token), now]
  );
  return updated.rowCount === 1;
}

// Step 2: actual redemption. Consumes the link exactly once and creates a
// session. Every failure collapses to a single non-disclosing outcome.
export type RedeemResult =
  | { ok: true; accountId: string }
  | { ok: false };

export async function redeemSignInLink(
  db: Pool,
  token: string,
  now: Date
): Promise<RedeemResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ id: string; account_id: string }>(
      `UPDATE signin_links
          SET redeemed_at = $2
        WHERE token_hash = $1
          AND redeemed_at IS NULL
          AND confirmed_at IS NOT NULL
          AND invalidated_at IS NULL
          AND expires_at > $2
        RETURNING id, account_id`,
      [hashToken(token), now]
    );
    if (updated.rows.length !== 1) {
      await recordAudit(client, {
        actorType: "system",
        action: "signin_link.redeemed",
        outcome: "failure",
        targetCategory: "signin_link",
        details: { reason: "unacceptable_link" }
      });
      await client.query("COMMIT"); // persist the failure audit only
      return { ok: false };
    }
    const link = updated.rows[0];

    const acct = await client.query<{ state: string }>(
      "SELECT state FROM accounts WHERE id = $1 FOR UPDATE",
      [link.account_id]
    );
    if (acct.rows[0]?.state !== "active") {
      // Suspension/closure between confirm and redeem blocks authentication.
      await recordAudit(client, {
        actorType: "system",
        action: "signin_link.redeemed",
        outcome: "denied",
        targetCategory: "signin_link",
        targetId: link.id,
        details: { reason: "account_not_active" }
      });
      await client.query("COMMIT");
      return { ok: false };
    }

    await recordAudit(client, {
      actorType: "user",
      actorAccountId: link.account_id,
      action: "signin_link.redeemed",
      outcome: "success",
      targetCategory: "signin_link",
      targetId: link.id
    });
    await client.query("COMMIT");
    return { ok: true, accountId: link.account_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
