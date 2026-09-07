// H10 — HTTP hardening: security headers, body-limit handling, auth rate limits.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  makeHarness,
  resetDb,
  request,
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
});
