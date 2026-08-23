// T2.1 — Invitation lifecycle (FR-0, ADR-025, ADR-026).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  acceptInvitation,
  expireStaleInvitations,
  issueInvitation,
  revokeInvitation
} from "../src/identity/invitations.js";
import {
  createBootstrapAdmin,
  DAY_MS,
  makeHarness,
  resetDb,
  sessionCookie,
  request,
  withServer,
  type Harness
} from "./helpers.js";

let h: Harness;
const now = new Date("2026-08-23T12:00:00Z");

beforeEach(async () => {
  h = makeHarness();
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

describe("invitation lifecycle", () => {
  it("issues a valid invitation bound to the email, expiring in 14 days", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const result = await issueInvitation(h.db, "newuser@example.invalid", admin, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.expiresAt.getTime()).toBe(now.getTime() + 14 * DAY_MS);
  });

  it("rejects a second issue while an unexpired issued invitation exists", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    await issueInvitation(h.db, "newuser@example.invalid", admin, now);
    const again = await issueInvitation(h.db, "newuser@example.invalid", admin, now);
    expect(again).toEqual({ ok: false, reason: "pending_exists" });
  });

  it("acceptance creates an active account and marks the invitation accepted", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const inv = await issueInvitation(h.db, "newuser@example.invalid", admin, now);
    if (!inv.ok) throw new Error("setup");
    const accept = await acceptInvitation(h.db, inv.token, now);
    expect(accept.ok).toBe(true);
    const account = await h.db.query("SELECT state FROM accounts WHERE email = $1", [
      "newuser@example.invalid"
    ]);
    expect(account.rows[0].state).toBe("active");
    const status = await h.db.query("SELECT status FROM invitations WHERE id = $1", [
      inv.invitationId
    ]);
    expect(status.rows[0].status).toBe("accepted");
  });

  it("expired invitations fail acceptance without creating an account", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const inv = await issueInvitation(h.db, "late@example.invalid", admin, now);
    if (!inv.ok) throw new Error("setup");
    const later = new Date(now.getTime() + 15 * DAY_MS);
    const accept = await acceptInvitation(h.db, inv.token, later);
    expect(accept).toEqual({ ok: false, reason: "invalid_token" });
    const accounts = await h.db.query(
      "SELECT id FROM accounts WHERE email = 'late@example.invalid'"
    );
    expect(accounts.rows).toHaveLength(0);
  });

  it("revoked invitations fail acceptance; re-issue after revocation works", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const inv = await issueInvitation(h.db, "revoked@example.invalid", admin, now);
    if (!inv.ok) throw new Error("setup");
    const revoked = await revokeInvitation(h.db, inv.invitationId, admin, now);
    expect(revoked).toBe(true);
    const accept = await acceptInvitation(h.db, inv.token, now);
    expect(accept).toEqual({ ok: false, reason: "invalid_token" });

    const reissue = await issueInvitation(h.db, "revoked@example.invalid", admin, now);
    expect(reissue.ok).toBe(true);
  });

  it("re-issue is allowed after expiry and the old token stays invalid", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const first = await issueInvitation(h.db, "reissue@example.invalid", admin, now);
    if (!first.ok) throw new Error("setup");
    const later = new Date(now.getTime() + 15 * DAY_MS);
    const reissued = await issueInvitation(h.db, "reissue@example.invalid", admin, later);
    expect(reissued.ok).toBe(true);

    const oldAccept = await acceptInvitation(h.db, first.token, later);
    expect(oldAccept).toEqual({ ok: false, reason: "invalid_token" });
    if (!reissued.ok) return;
    const newAccept = await acceptInvitation(h.db, reissued.token, later);
    expect(newAccept.ok).toBe(true);
  });

  it("an unknown token fails identically to an expired one (non-disclosing)", async () => {
    const ghost = await acceptInvitation(h.db, "not-a-real-token-value-aaaaaaaaaaaaaaaa", now);
    expect(ghost).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("HTTP: every unacceptable invitation returns the same generic response", async () => {
    const app = h.app;
    await withServer(app, async (port) => {
      const bad1 = await request(port, "POST", "/api/auth/invitation/redeem", {
        body: { token: "garbage-token-00000000000000000" }
      });
      const bad2 = await request(port, "POST", "/api/auth/invitation/redeem", {
        body: { token: "another-wrong-token-0000000000000" }
      });
      const missing = await request(port, "POST", "/api/auth/invitation/redeem", {
        body: {}
      });
      for (const res of [bad1, bad2, missing]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "invalid_link" });
      }
    });
  });

  it("lazy sweep flips past-expiry issued invitations to expired status", async () => {
    const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const inv = await issueInvitation(h.db, "stale@example.invalid", admin, now);
    if (!inv.ok) throw new Error("setup");
    await expireStaleInvitations(h.db, new Date(now.getTime() + 15 * DAY_MS));
    const row = await h.db.query("SELECT status FROM invitations WHERE id = $1", [
      inv.invitationId
    ]);
    expect(row.rows[0].status).toBe("expired");
  });
});

// Silence unused-import lint for the cookie helper used by other suites.
void sessionCookie;
