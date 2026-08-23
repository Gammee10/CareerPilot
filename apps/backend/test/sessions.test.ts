// T2.3 — Session lifetimes and revocation (ADR-027).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createSession, validateSession } from "../src/identity/sessions.js";
import { suspendAccount, closeAccount } from "../src/identity/accounts.js";
import {
  createBootstrapAdmin,
  createActiveUser,
  DAY_MS,
  HOUR_MS,
  makeHarness,
  resetDb,
  type Harness
} from "./helpers.js";

let h: Harness;
const t0 = new Date("2026-08-23T12:00:00Z");

beforeEach(async () => {
  h = makeHarness();
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

async function setup() {
  const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const user = await createActiveUser(h, "user@example.invalid", adminId, t0);
  return { adminId, userId: user.accountId };
}

describe("session lifetimes", () => {
  it("user sessions live 30 days absolute / 7 days idle", async () => {
    const { userId } = await setup();
    const s = await createSession(h.db, userId, "user", t0);
    const row = await h.db.query<{ absolute_expires_at: Date; idle_expires_at: Date }>(
      "SELECT absolute_expires_at, idle_expires_at FROM sessions WHERE id = $1",
      [s.session.id]
    );
    expect(row.rows[0].absolute_expires_at.getTime()).toBe(t0.getTime() + 30 * DAY_MS);
    expect(row.rows[0].idle_expires_at.getTime()).toBe(t0.getTime() + 7 * DAY_MS);
  });

  it("admin sessions live 12 hours absolute / 1 hour idle", async () => {
    const { adminId } = await setup();
    const s = await createSession(h.db, adminId, "admin", t0);
    const row = await h.db.query<{ absolute_expires_at: Date; idle_expires_at: Date }>(
      "SELECT absolute_expires_at, idle_expires_at FROM sessions WHERE id = $1",
      [s.session.id]
    );
    expect(row.rows[0].absolute_expires_at.getTime()).toBe(t0.getTime() + 12 * HOUR_MS);
    expect(row.rows[0].idle_expires_at.getTime()).toBe(t0.getTime() + HOUR_MS);
  });

  it("activity refreshes the idle window but never extends the absolute lifetime", async () => {
    const { userId } = await setup();
    const s = await createSession(h.db, userId, "user", t0);
    const active = new Date(t0.getTime() + 6 * DAY_MS);
    const v1 = await validateSession(h.db, s.token, active);
    expect(v1.ok).toBe(true);

    const row = await h.db.query<{ absolute_expires_at: Date; idle_expires_at: Date }>(
      "SELECT absolute_expires_at, idle_expires_at FROM sessions WHERE id = $1",
      [s.session.id]
    );
    // Idle window moved forward from the activity point.
    expect(row.rows[0].idle_expires_at.getTime()).toBe(active.getTime() + 7 * DAY_MS);
    // Absolute lifetime is untouched.
    expect(row.rows[0].absolute_expires_at.getTime()).toBe(t0.getTime() + 30 * DAY_MS);

    // Absolute expiry kills the session even with recent activity.
    const afterAbsolute = new Date(t0.getTime() + 30 * DAY_MS + HOUR_MS);
    const v2 = await validateSession(h.db, s.token, afterAbsolute);
    expect(v2.ok).toBe(false);
  });

  it("idle expiry ends the session", async () => {
    const { userId } = await setup();
    const s = await createSession(h.db, userId, "user", t0);
    const stale = new Date(t0.getTime() + 7 * DAY_MS + MINUTE_MS(1));
    expect((await validateSession(h.db, s.token, stale)).ok).toBe(false);
  });
});

describe("immediate revocation", () => {
  it("in-flight user session dies the moment the account is suspended (T2.3 AC)", async () => {
    const { adminId, userId } = await setup();
    const s = await createSession(h.db, userId, "user", t0);
    expect((await validateSession(h.db, s.token, t0)).ok).toBe(true);
    const result = await suspendAccount(h.db, userId, adminId, t0, {});
    expect(result.ok).toBe(true);
    expect((await validateSession(h.db, s.token, t0)).ok).toBe(false);
  });

  it("closure also revokes every session immediately", async () => {
    const { adminId, userId } = await setup();
    const s1 = await createSession(h.db, userId, "user", t0);
    const s2 = await createSession(h.db, userId, "user", new Date(t0.getTime() + 1000));
    await closeAccount(h.db, userId, adminId, t0, {});
    for (const s of [s1, s2]) {
      expect((await validateSession(h.db, s.token, t0)).ok).toBe(false);
    }
  });

  it("removal of administrator authority ends privileged sessions immediately", async () => {
    const { adminId } = await setup();
    const adminSession = await createSession(h.db, adminId, "admin", t0);
    expect((await validateSession(h.db, adminSession.token, t0)).ok).toBe(true);

    // Simulate an executed revoke of authority (dual-control execution path
    // performs exactly this state change plus session revocation).
    await h.db.query("UPDATE accounts SET is_admin = false WHERE id = $1", [adminId]);
    const after = await validateSession(h.db, adminSession.token, t0);
    expect(after.ok).toBe(false);
    const revokedRow = await h.db.query(
      "SELECT revoked_at FROM sessions WHERE id = $1",
      [adminSession.session.id]
    );
    expect(revokedRow.rows[0].revoked_at).not.toBeNull();
  });

  it("restoration re-enables authentication only through a new sign-in", async () => {
    const { adminId, userId } = await setup();
    const s = await createSession(h.db, userId, "user", t0);
    await suspendAccount(h.db, userId, adminId, t0, {});
    await import("../src/identity/accounts.js").then((m) =>
      m.restoreAccount(h.db, userId, adminId, t0)
    );
    // The old (revoked) session stays dead.
    expect((await validateSession(h.db, s.token, t0)).ok).toBe(false);
    // A fresh session works again.
    const fresh = await createSession(h.db, userId, "user", t0);
    expect((await validateSession(h.db, fresh.token, t0)).ok).toBe(true);
  });
});

function MINUTE_MS(n: number): number {
  return n * 60 * 1000;
}
