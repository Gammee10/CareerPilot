// Authenticated sessions (ADR-027): bounded absolute/idle lifetimes by role,
// immediate revocation on suspension/closure/admin-authority removal.
import type { Pool } from "pg";
import { recordAudit } from "./audit.js";
import { generateToken, hashToken } from "./tokens.js";
import { config } from "../config.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type SessionRole = "user" | "admin";

export type SessionRow = {
  id: string;
  account_id: string;
  role: SessionRole;
};

export type SessionLifetimes = { absoluteMs: number; idleMs: number };

function lifetimesFor(role: SessionRole, override?: SessionLifetimes): SessionLifetimes {
  if (override) return override;
  return role === "admin"
    ? { absoluteMs: config.identity.adminSessionAbsoluteHours * HOUR_MS,
        idleMs: config.identity.adminSessionIdleHours * HOUR_MS }
    : { absoluteMs: config.identity.userSessionAbsoluteDays * DAY_MS,
        idleMs: config.identity.userSessionIdleDays * DAY_MS };
}

export async function createSession(
  db: Pool,
  accountId: string,
  role: SessionRole,
  now: Date,
  lifetimeOverride?: SessionLifetimes
): Promise<{ token: string; session: SessionRow }> {
  const lifetime = lifetimesFor(role, lifetimeOverride);

  const token = generateToken();
  const inserted = await db.query<SessionRow>(
    `INSERT INTO sessions
       (account_id, role, token_hash, absolute_expires_at, idle_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_id, role`,
    [
      accountId,
      role,
      hashToken(token),
      new Date(now.getTime() + lifetime.absoluteMs),
      new Date(now.getTime() + lifetime.idleMs)
    ]
  );
  await recordAudit(db, {
    actorType: role === "admin" ? "admin" : "user",
    actorAccountId: accountId,
    action: "session.created",
    outcome: "success",
    targetCategory: "session",
    targetId: inserted.rows[0].id,
    details: { role }
  });
  return { token, session: inserted.rows[0] };
}

export type ValidateResult =
  | { ok: true; session: SessionRow }
  | { ok: false };

// Validates and refreshes the idle window (activity). Revoked, expired, or
// suspended/closed-account sessions fail closed.
export async function validateSession(
  db: Pool,
  rawToken: string,
  now: Date
): Promise<ValidateResult> {
  const { rows } = await db.query<
    SessionRow & {
      absolute_expires_at: Date;
      idle_expires_at: Date;
      revoked_at: Date | null;
      account_state: "active" | "suspended" | "closed";
      account_is_admin: boolean;
    }
  >(
    `SELECT s.id, s.account_id, s.role, s.absolute_expires_at, s.idle_expires_at,
            s.revoked_at, a.state AS account_state, a.is_admin AS account_is_admin
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1`,
    [hashToken(rawToken)]
  );
  const row = rows[0];
  if (!row) return { ok: false };
  if (row.revoked_at !== null) return { ok: false };
  if (row.absolute_expires_at.getTime() <= now.getTime()) return { ok: false };
  if (row.idle_expires_at.getTime() <= now.getTime()) return { ok: false };
  if (row.account_state !== "active") return { ok: false }; // defense in depth

  // Admin sessions require retained administrator authority.
  const role: SessionRole =
    row.role === "admin" && row.account_is_admin ? "admin" : "user";
  if (row.role === "admin" && !row.account_is_admin) {
    // Authority removed: end the privileged session immediately.
    await db.query(
      "UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [row.id, now]
    );
    await recordAudit(db, {
      actorType: "system",
      action: "session.revoked",
      outcome: "success",
      targetCategory: "session",
      targetId: row.id,
      details: { reason: "admin_authority_removed" }
    });
    return { ok: false };
  }

  // Refresh the idle window from the effective role policy (activity).
  const effectiveRole: SessionRole = row.role === "admin" && row.account_is_admin ? "admin" : "user";
  const idleMs =
    effectiveRole === "admin"
      ? config.identity.adminSessionIdleHours * HOUR_MS
      : config.identity.userSessionIdleDays * DAY_MS;
  const newIdle = new Date(now.getTime() + idleMs);
  if (newIdle.getTime() < row.idle_expires_at.getTime()) newIdle.setTime(row.idle_expires_at.getTime());
  await db.query("UPDATE sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1", [
    row.id,
    now,
    newIdle
  ]);
  return { ok: true, session: { id: row.id, account_id: row.account_id, role } };
}

export async function revokeSession(
  db: Pool,
  sessionId: string,
  actorAccountId: string,
  now: Date,
  reason: string
): Promise<void> {
  await db.query(
    "UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
    [sessionId, now]
  );
  await recordAudit(db, {
    actorType: "user",
    actorAccountId,
    action: "session.revoked",
    outcome: "success",
    targetCategory: "session",
    targetId: sessionId,
    details: { reason }
  });
}
