// H10/H11/M6 + /api-prefix routing — HTTP hardening: security headers,
// body-limit handling, auth rate limits, cookie flags, UUID param guards,
// and the Caddy-preserved /api prefix on health probes.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  makeHarness,
  resetDb,
  request,
  sessionCookie,
  withServer,
  type Harness
} from "./helpers.js";

let h: Harness;

beforeEach(async () => {
  h = makeHarness();
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

describe("HTTP hardening (H10)", () => {
  it("emits API security headers on every response", async () => {
    await withServer(h.app, async (port) => {
      const res = await request(port, "GET", "/api/me");
      expect(res.status).toBe(401);
      const get = (n: string) => {
        const v = res.getHeader(n);
        return Array.isArray(v) ? v[0] : v;
      };
      expect(get("x-content-type-options")).toBe("nosniff");
      expect(get("x-frame-options")).toBe("DENY");
      expect(get("content-security-policy")).toContain("frame-ancestors");
      expect(get("cross-origin-resource-policy")).toBe("same-origin");
      expect(get("x-powered-by")).toBeUndefined();
    });
  });

  it("malformed JSON fails closed as 400, never 500", async () => {
    await withServer(h.app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/signin-link/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad json"
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_json" });
    });
  });

  it("over-limit bodies fail closed as 413", async () => {
    await withServer(h.app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/signin-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x".repeat(120 * 1024) })
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "payload_too_large" });
    });
  });

  it("IP-level rate limit trips after a burst with Retry-After on 429", async () => {
    await withServer(h.app, async (port) => {
      let lastStatus = 0;
      let retryAfter: string | string[] | undefined;
      // Issuance budget is 30/min; unknown emails never touch per-email DB
      // limits, so only the IP limiter can fire here.
      for (let i = 0; i < 35; i++) {
        const res = await request(port, "POST", "/api/auth/signin-link", {
          body: { email: `burst-${i}@example.invalid` }
        });
        lastStatus = res.status;
        if (res.status === 429) {
          retryAfter = res.getHeader("retry-after");
          break;
        }
      }
      expect(lastStatus).toBe(429);
      expect(retryAfter).toBe("60");
    });
  }, 30_000);

  it("H11: session cookie carries flags; logout clears with mirrored attributes", async () => {    // Fixed clock: link validity is time-bound, so this test needs its own
    // harness like the other auth suites (the file-level harness uses real
    // time, which would expiry-fail a fixed-t0 link).
    const { createBootstrapAdmin, createActiveUser, makeHarness: makeFixedHarness, resetDb: resetFixedDb } =
      await import("./helpers.js");
    const t0 = new Date("2026-08-23T12:00:00Z");
    const fixed = makeFixedHarness(() => new Date(t0.getTime() + 60_000));
    try {
      await resetFixedDb(fixed.db);
      const adminId = await createBootstrapAdmin(fixed.db, "admin@example.invalid");
      await createActiveUser(fixed, "cookie@example.invalid", adminId, t0);
      const { requestSignInLink, confirmSignInLink } = await import(
        "../src/identity/signinLinks.js"
      );
      await withServer(fixed.app, async (port) => {
        const link = await requestSignInLink(fixed.db, "cookie@example.invalid", t0);
        if (!link.ok) throw Error("setup");
        await confirmSignInLink(fixed.db, link.token, t0);
        const redeem = await request(port, "POST", "/api/auth/signin-link/redeem", {
          body: { token: link.token }
        });
        expect(redeem.status).toBe(200);
      const setCookie = String(redeem.getHeader("set-cookie") ?? "");
      expect(setCookie).toContain("cp_session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("Max-Age=2592000"); // 30-day absolute lifetime

      const cookie = setCookie.split(";")[0];
      const logout = await request(port, "POST", "/api/auth/logout", { cookie });
      expect(logout.status).toBe(200);
      const cleared = String(logout.getHeader("set-cookie") ?? "");
      expect(cleared).toContain("cp_session=;");
      expect(cleared).toContain("Max-Age=0");
      expect(cleared).toContain("Path=/");
      expect(cleared).toContain("HttpOnly");
      expect(cleared).toContain("SameSite=Lax");
      });
    } finally {
      await fixed.close();
    }
  });

  it("M6: malformed UUID params fail closed as 404, never 500", async () => {
    const { createBootstrapAdmin, createActiveUser } = await import("./helpers.js");
    const t0 = new Date("2026-08-23T12:00:00Z");
    const fixed = makeHarness(() => new Date(t0.getTime() + 60_000));
    try {
      await resetDb(fixed.db);
      const adminId = await createBootstrapAdmin(fixed.db, "admin@example.invalid");
      const user = await createActiveUser(fixed, "uuid@example.invalid", adminId, t0);
      const { requestSignInLink, confirmSignInLink } = await import(
        "../src/identity/signinLinks.js"
      );
      const link = await requestSignInLink(fixed.db, "uuid@example.invalid", t0);
      if (!link.ok) throw Error("setup");
      await confirmSignInLink(fixed.db, link.token, t0);
      await withServer(fixed.app, async (port) => {
        const redeem = await request(port, "POST", "/api/auth/signin-link/redeem", {
          body: { token: link.token }
        });
        const cookie = sessionCookie(redeem);
        const cases: Array<[string, "GET" | "POST" | "PUT", unknown?]> = [
          ["/api/account/not-a-uuid/jobs", "GET"],
          [`/api/account/${user.accountId}/jobs/not-a-uuid/detail`, "GET"],
          [`/api/account/${user.accountId}/resume/not-a-uuid/extract`, "POST"],
          [`/api/account/${user.accountId}/extraction-drafts/not-a-uuid`, "GET"],
          ["/api/admin/accounts/not-a-uuid/suspend", "POST"]
        ];
        for (const [path, method, body] of cases) {
          const res = await request(port, method, path, {
            cookie,
            body: body ?? (method === "GET" ? undefined : {})
          });
          expect(res.status).toBe(404);
          expect(res.body).toEqual({ error: "not_found" });
        }
      });
    } finally {
      await fixed.close();
    }
  });

  it("/api-prefixed health probes match backend routes (Caddy preserves the prefix)", async () => {
    await withServer(h.app, async (port) => {
      for (const path of ["/healthz", "/api/healthz", "/readyz", "/api/readyz"]) {
        const res = await request(port, "GET", path);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: expect.any(String) });
      }
    });
  });
});
