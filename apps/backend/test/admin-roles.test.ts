// T2.5 — Dual-controlled administrator-role lifecycle (ADR-031).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initiateRoleChange, approveRoleChange } from "../src/identity/adminRoles.js";
import {
  createBootstrapAdmin,
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

// Three bootstrap administrators (documented bootstrap procedure, audited).
async function setupAdmins() {
  return {
    adminA: await createBootstrapAdmin(h.db, "admin-a@example.invalid"),
    adminB: await createBootstrapAdmin(h.db, "admin-b@example.invalid"),
    adminC: await createBootstrapAdmin(h.db, "admin-c@example.invalid")
  };
}

async function isAdmin(accountId: string): Promise<boolean> {
  const row = await h.db.query<{ is_admin: boolean }>(
    "SELECT is_admin FROM accounts WHERE id = $1",
    [accountId]
  );
  return row.rows[0].is_admin;
}

describe("dual control (ADR-031)", () => {
  it("requires an authorized administrator to initiate a change", async () => {
    const { adminA } = await setupAdmins();
    const { createActiveUser } = await import("./helpers.js");
    const plain = await createActiveUser(h, "plain@example.invalid", adminA, t0);
    const result = await initiateRoleChange(h.db, plain.accountId, plain.accountId, "grant", t0);
    expect(result).toEqual({ ok: false, reason: "not_admin" });
  });

  it("self-approval is refused and audit-recorded (T2.5 AC)", async () => {
    const { adminA } = await setupAdmins();    const initiated = await initiateRoleChange(h.db, adminA, adminA, "revoke", t0);
    if (!initiated.ok) throw Error("setup");
    const approved = await approveRoleChange(h.db, initiated.changeId, adminA, t0);
    expect(approved).toEqual({ ok: false, reason: "self_approval" });

    const audit = await h.db.query(
      `SELECT id FROM audit_events WHERE action = 'admin_role.self_approval_denied'
        AND target_id = $1`,
      [initiated.changeId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(await isAdmin(adminA)).toBe(true);
    const status = await h.db.query("SELECT status FROM administrator_role_changes WHERE id = $1", [
      initiated.changeId
    ]);
    expect(status.rows[0].status).toBe("pending");
  });

  it("the initiator cannot approve even when the target is someone else", async () => {
    const { adminA, adminB, adminC } = await setupAdmins();
    void adminB;
    const initiated = await initiateRoleChange(h.db, adminA, adminC, "grant", t0);
    if (!initiated.ok) throw Error("setup");
    const attempt = await approveRoleChange(h.db, initiated.changeId, adminA, t0);
    expect(attempt).toEqual({ ok: false, reason: "self_approval" });
  });

  it("independent approval executes the grant with full auditing", async () => {
    const { adminA, adminB, adminC } = await setupAdmins();
    const initiated = await initiateRoleChange(h.db, adminA, adminC, "grant", t0);
    if (!initiated.ok) throw Error("setup");
    const approved = await approveRoleChange(h.db, initiated.changeId, adminB, t0);
    expect(approved).toEqual({ ok: true, executed: true });
    expect(await isAdmin(adminC)).toBe(true);

    const actions = await h.db.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at",
      [initiated.changeId]
    );
    const names = actions.rows.map((r) => r.action);
    expect(names).toContain("admin_role.change_initiated");
    expect(names).toContain("admin_role.granted");

    // Executed change records BOTH identities for review (ADR-031/017 style).
    const row = await h.db.query<{
      initiated_by_account_id: string;
      approved_by_account_id: string;
      status: string;
    }>("SELECT initiated_by_account_id, approved_by_account_id, status FROM administrator_role_changes WHERE id = $1",
      [initiated.changeId]);
    expect(row.rows[0]).toMatchObject({
      initiated_by_account_id: adminA,
      approved_by_account_id: adminB,
      status: "executed"
    });
  });

  it("revocation removes authority and ends privileged sessions immediately", async () => {
    const { adminA, adminB, adminC } = await setupAdmins();
    const { createSession, validateSession } = await import("../src/identity/sessions.js");
    const bSession = await createSession(h.db, adminB, "admin", t0);
    expect((await validateSession(h.db, bSession.token, t0)).ok).toBe(true);

    const initiated = await initiateRoleChange(h.db, adminA, adminB, "revoke", t0);
    if (!initiated.ok) throw Error("setup");
    const approved = await approveRoleChange(h.db, initiated.changeId, adminC, t0);
    expect(approved).toEqual({ ok: true, executed: true });
    expect(await isAdmin(adminB)).toBe(false);
    // Privileged session dies immediately (ADR-027).
    expect((await validateSession(h.db, bSession.token, t0)).ok).toBe(false);
  });

  it("last-admin protection blocks removal of the final active administrator", async () => {
    const { adminA, adminB, adminC } = await setupAdmins();

    // Pre-stage: B initiates a revoke of A (stays pending).
    const revokeA = await initiateRoleChange(h.db, adminB, adminA, "revoke", t0);
    if (!revokeA.ok) throw Error("setup");

    // Strip C via dual control (initiator A, approver B).
    const revokeC = await initiateRoleChange(h.db, adminA, adminC, "revoke", t0);
    if (!revokeC.ok) throw Error("setup");
    expect(await approveRoleChange(h.db, revokeC.changeId, adminB, t0))
      .toEqual({ ok: true, executed: true });

    // Strip B via dual control (initiator A, approver B as differing admin).
    // Now exactly ONE admin remains: A.
    const revokeB = await initiateRoleChange(h.db, adminA, adminB, "revoke", t0);
    if (!revokeB.ok) throw Error("setup");
    expect(await approveRoleChange(h.db, revokeB.changeId, adminB, t0))
      .toEqual({ ok: true, executed: true });
    expect(await isAdmin(adminB)).toBe(false);
    expect(await isAdmin(adminC)).toBe(false);

    // A approves B's pending revoke-of-A. Approver != initiator and A is a
    // valid admin — but executing it would leave zero admins. The guard
    // must refuse AND audit.
    const attempt = await approveRoleChange(h.db, revokeA.changeId, adminA, t0);
    expect(attempt).toEqual({ ok: false, reason: "last_admin" });
    expect(await isAdmin(adminA)).toBe(true);

    const audit = await h.db.query(
      "SELECT id FROM audit_events WHERE action = 'admin_role.last_admin_protected'"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
