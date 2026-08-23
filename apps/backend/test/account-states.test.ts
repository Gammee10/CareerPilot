// T2.4 — Account state machine (ADR-025).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  closeAccount,
  restoreAccount,
  suspendAccount,
  findAccountById
} from "../src/identity/accounts.js";
import { createSession, validateSession } from "../src/identity/sessions.js";
import { requestSignInLink, redeemSignInLink } from "../src/identity/signinLinks.js";
import {
  createBootstrapAdmin,
  createActiveUser,
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

describe("account state machine", () => {
  it("active -> suspended -> active is allowed", async () => {
    const { adminId, userId } = await setup();
    expect((await suspendAccount(h.db, userId, adminId, t0, {})).ok).toBe(true);
    expect((await findAccountById(h.db, userId))?.state).toBe("suspended");
    expect((await restoreAccount(h.db, userId, adminId, t0)).ok).toBe(true);
    expect((await findAccountById(h.db, userId))?.state).toBe("active");
  });

  it("active -> closed and suspended -> closed are allowed; closure sets closed_at", async () => {
    const { adminId, userId } = await setup();
    await suspendAccount(h.db, userId, adminId, t0, {});
    const result = await closeAccount(h.db, userId, adminId, new Date(t0.getTime() + 1000), {});
    expect(result.ok).toBe(true);
    const row = await h.db.query<{ state: string; closed_at: Date }>(
      "SELECT state, closed_at FROM accounts WHERE id = $1",
      [userId]
    );
    expect(row.rows[0].state).toBe("closed");
    expect(row.rows[0].closed_at.getTime()).toBe(t0.getTime() + 1000);
  });

  it("closed is terminal: no restore, no re-suspend, no re-close", async () => {
    const { adminId, userId } = await setup();
    await closeAccount(h.db, userId, adminId, t0, {});
    expect((await restoreAccount(h.db, userId, adminId, t0)).ok).toBe(false);
    expect((await suspendAccount(h.db, userId, adminId, t0, {})).ok).toBe(false);
    expect((await closeAccount(h.db, userId, adminId, t0, {})).ok).toBe(false);
  });

  it("closure immediately blocks access and new authentication (ADR-025/027)", async () => {
    const { adminId, userId } = await setup();
    // Existing session dies.
    const s = await createSession(h.db, userId, "user", t0);
    // Pending sign-in link can no longer authenticate the account.
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw Error("setup");
    await closeAccount(h.db, userId, adminId, t0, {});
    expect((await validateSession(h.db, s.token, t0)).ok).toBe(false);
    expect(await redeemSignInLink(h.db, link.token, t0)).toEqual({ ok: false });
    // Background-work gate (ADR-045): non-active accounts never receive work.
    const gate = await h.db.query("SELECT state FROM accounts WHERE id = $1", [userId]);
    expect(gate.rows[0].state).toBe("closed");
  });

  it("lifecycle transitions and failures are audit-recorded", async () => {
    const { adminId, userId } = await setup();
    await suspendAccount(h.db, userId, adminId, t0, {});
    await closeAccount(h.db, userId, adminId, t0, {});
    await restoreAccount(h.db, userId, adminId, t0); // must fail + be audited
    const events = await h.db.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM audit_events
        WHERE target_id = $1 AND action LIKE 'account.%'
        ORDER BY occurred_at`,
      [userId]
    );
    const actions = events.rows.map((r) => `${r.action}:${r.outcome}`);
    expect(actions).toContain("account.suspended:success");
    expect(actions).toContain("account.closed:success");
    expect(actions).toContain("account.restored:failure");
  });
});
