// T2.2 — Passwordless sign-in links (ADR-018/026).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  confirmSignInLink,
  redeemSignInLink,
  requestSignInLink
} from "../src/identity/signinLinks.js";
import { createSession } from "../src/identity/sessions.js";
import {
  createActiveUser,
  createBootstrapAdmin,
  makeHarness,
  MINUTE_MS,
  resetDb,
  request,
  sessionCookie,
  withServer,
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

async function setupUser(email = "user@example.invalid") {
  const admin = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const user = await createActiveUser(h, email, admin, t0);
  return { adminId: admin, ...user };
}

describe("sign-in link issuance", () => {
  it("issues a link valid for 15 minutes, persisted hash-only", async () => {
    const { accountId } = await setupUser();
    const result = await requestSignInLink(h.db, "user@example.invalid", t0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt.getTime()).toBe(t0.getTime() + 15 * MINUTE_MS);
    const row = await h.db.query<{ token_hash: string }>(
      "SELECT token_hash FROM signin_links WHERE account_id = $1",
      [accountId]
    );
    // Only the SHA-256 hash is stored; the raw token never persists.
    expect(row.rows[0].token_hash).not.toBe(result.token);
    expect(row.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("unknown emails are silently suppressed with no delivery", async () => {
    const result = await requestSignInLink(h.db, "nobody@example.invalid", t0);
    expect(result).toEqual({ ok: false, reason: "suppressed" });
    expect(h.mailer.signInLinks).toHaveLength(0);
  });

  it("issuing a new link invalidates the prior unused link (ADR-018)", async () => {
    await setupUser();
    const first = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!first.ok) throw new Error("setup");
    const second = await requestSignInLink(
      h.db,
      "user@example.invalid",
      new Date(t0.getTime() + MINUTE_MS)
    );
    if (!second.ok) throw new Error("setup");

    // First link can no longer be confirmed or redeemed.
    const confirmOld = await confirmSignInLink(h.db, first.token, t0);
    expect(confirmOld).toBe(false);
    const redeemOld = await redeemSignInLink(h.db, first.token, t0);
    expect(redeemOld).toEqual({ ok: false });

    // Second link works end to end.
    const confirmNew = await confirmSignInLink(
      h.db,
      second.token,
      new Date(t0.getTime() + MINUTE_MS)
    );
    expect(confirmNew).toBe(true);
  });
});

describe("confirmation-before-redemption", () => {
  it("confirm does not consume the link or authenticate", async () => {
    const { accountId } = await setupUser();
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw new Error("setup");
    const confirmed = await confirmSignInLink(h.db, link.token, t0);
    expect(confirmed).toBe(true);

    // Link is still unconsumed.
    const row = await h.db.query(
      "SELECT redeemed_at, confirmed_at FROM signin_links WHERE account_id = $1",
      [accountId]
    );
    expect(row.rows[0].redeemed_at).toBeNull();
    expect(row.rows[0].confirmed_at).not.toBeNull();

    const redeem = await redeemSignInLink(h.db, link.token, t0);
    expect(redeem.ok).toBe(true);
  });

  it("redemption without confirmation fails (scanner that skips the page)", async () => {
    await setupUser();
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw new Error("setup");
    const result = await redeemSignInLink(h.db, link.token, t0);
    expect(result).toEqual({ ok: false });
  });

  it("a link redeems exactly once; replay fails generically", async () => {
    await setupUser();
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw Error("setup");
    await confirmSignInLink(h.db, link.token, t0);
    const first = await redeemSignInLink(h.db, link.token, t0);
    expect(first.ok).toBe(true);
    const replay = await redeemSignInLink(h.db, link.token, t0);
    expect(replay).toEqual({ ok: false });
  });

  it("expired links cannot be confirmed or redeemed", async () => {
    await setupUser();
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw Error("setup");
    const later = new Date(t0.getTime() + 16 * MINUTE_MS);
    expect(await confirmSignInLink(h.db, link.token, later)).toBe(false);
    expect(await redeemSignInLink(h.db, link.token, later)).toEqual({ ok: false });
  });
});

describe("issuance limits (ADR-026)", () => {
  it("allows three per 15 minutes and suppresses the fourth non-disclosingly", async () => {
    await setupUser();
    for (let i = 0; i < 3; i++) {
      const r = await requestSignInLink(h.db, "user@example.invalid", t0);
      expect(r.ok).toBe(true);
    }
    const fourth = await requestSignInLink(h.db, "user@example.invalid", t0);
    expect(fourth).toEqual({ ok: false, reason: "suppressed" });

    const later = new Date(t0.getTime() + 16 * MINUTE_MS);
    const afterWindow = await requestSignInLink(h.db, "user@example.invalid", later);
    expect(afterWindow.ok).toBe(true);
  });

  it("enforces ten per rolling 24 hours", async () => {
    await setupUser();
    let t = t0;
    for (let i = 0; i < 10; i++) {
      const r = await requestSignInLink(h.db, "user@example.invalid", t);
      expect(r.ok).toBe(true);
      t = new Date(t.getTime() + 61 * MINUTE_MS); // stay under 15-min window
    }
    const eleventh = await requestSignInLink(h.db, "user@example.invalid", t);
    expect(eleventh).toEqual({ ok: false, reason: "suppressed" });
    const nextDay = new Date(t0.getTime() + 24 * 60 * MINUTE_MS + MINUTE_MS);
    const recovered = await requestSignInLink(h.db, "user@example.invalid", nextDay);
    expect(recovered.ok).toBe(true);
  });
});

describe("HTTP surface non-disclosure", () => {
  it("signin-link responses are identical for known and unknown emails", async () => {
    await setupUser();
    await withServer(h.app, async (port) => {
      const known = await request(port, "POST", "/api/auth/signin-link", {
        body: { email: "user@example.invalid" }
      });
      const unknown = await request(port, "POST", "/api/auth/signin-link", {
        body: { email: "who-is-this@example.invalid" }
      });
      const malformed = await request(port, "POST", "/api/auth/signin-link", {
        body: {}
      });
      for (const res of [known, unknown, malformed]) {
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ status: "accepted" });
      }
      expect(h.mailer.signInLinks).toHaveLength(1); // only the real one delivered
    });
  });

  it("confirm/redeem failures all return the same generic error", async () => {
    await setupUser();
    await withServer(h.app, async (port) => {
      const cases = [
        { path: "/api/auth/signin-link/confirm", token: "bogus-token-aaaaaaaaaaaaaa" },
        { path: "/api/auth/signin-link/redeem", token: "bogus-token-bbbbbbbbbbbbbb" },
        { path: "/api/auth/signin-link/redeem" }
      ];
      for (const c of cases) {
        const res = await request(port, "POST", c.path, { body: { token: c.token } });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "invalid_link" });
      }
    });
  });

  it("full happy path over HTTP yields an authenticated session cookie", async () => {
    await setupUser();
    await withServer(h.app, async (port) => {
      await request(port, "POST", "/api/auth/signin-link", {
        body: { email: "user@example.invalid" }
      });
      const token = h.mailer.signInLinks[0].url.split("token=")[1];
      const confirm = await request(port, "POST", "/api/auth/signin-link/confirm", {
        body: { token }
      });
      expect(confirm.body).toEqual({ status: "confirmed" });
      const redeem = await request(port, "POST", "/api/auth/signin-link/redeem", {
        body: { token }
      });
      expect(redeem.status).toBe(200);
      expect(sessionCookie(redeem)).toMatch(/^cp_session=/);

      const me = await request(port, "GET", "/api/me", {
        cookie: sessionCookie(redeem)
      });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ isAdmin: false });
    });
  });

  it("suspension between confirm and redeem blocks authentication (ADR-027)", async () => {
    const { adminId } = await setupUser();
    const { suspendAccount } = await import("../src/identity/accounts.js");
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw Error("setup");
    await confirmSignInLink(h.db, link.token, t0);
    const me = await h.db.query<{ id: string }>(
      "SELECT id FROM accounts WHERE email = 'user@example.invalid'"
    );
    await suspendAccount(h.db, me.rows[0].id, adminId, t0, {});
    const redeem = await redeemSignInLink(h.db, link.token, t0);
    expect(redeem).toEqual({ ok: false });
  });

  it("session created by redemption dies on immediate suspension (T2.3 AC)", async () => {
    const { adminId } = await setupUser();
    const { suspendAccount } = await import("../src/identity/accounts.js");
    const { validateSession } = await import("../src/identity/sessions.js");
    const link = await requestSignInLink(h.db, "user@example.invalid", t0);
    if (!link.ok) throw Error("setup");
    await confirmSignInLink(h.db, link.token, t0);
    const redeemed = await redeemSignInLink(h.db, link.token, t0);
    if (!redeemed.ok) throw Error("setup");
    const session = await createSession(h.db, redeemed.accountId, "user", t0);
    void link;
    expect((await validateSession(h.db, session.token, t0)).ok).toBe(true);
    await suspendAccount(h.db, redeemed.accountId, adminId, t0, {});
    expect((await validateSession(h.db, session.token, t0)).ok).toBe(false);
  });
});
