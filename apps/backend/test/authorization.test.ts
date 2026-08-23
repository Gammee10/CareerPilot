// T2.6 â€” Deny-by-default, resource-level authorization (ADR-016).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createActiveUser,
  createBootstrapAdmin,
  makeHarness,
  resetDb,
  request,
  sessionCookie,
  withServer,
  type Harness
} from "./helpers.js";

let h: Harness;
const t0 = new Date("2026-08-23T12:00:00Z");
const RESOURCES = [
  "profile",
  "resume",
  "search-strategy",
  "discovery-runs",
  "evaluations",
  "reviews"
];

beforeEach(async () => {
  // Fixed clock slightly after fixture time t0 so links/sessions are live.
  const routeNow = new Date(t0.getTime() + 60_000);
  h = makeHarness(() => routeNow);
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

type Users = {
  port: number;
  userACookie: string;
  userBCookie: string;
  adminCookie: string;
  accountA: string;
  accountB: string;
};

async function setupUsers(port: number): Promise<Users> {
  const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const invA = await createActiveUser(h, "a@example.invalid", adminId, t0);
  const invB = await createActiveUser(h, "b@example.invalid", adminId, t0);

  // Sessions for A and B via the real sign-in path.
  const { requestSignInLink, confirmSignInLink } = await import(
    "../src/identity/signinLinks.js"
  );
  const linkA = await requestSignInLink(h.db, "a@example.invalid", t0);
  if (!linkA.ok) throw Error("setup");
  const linkB = await requestSignInLink(h.db, "b@example.invalid", new Date(t0.getTime() + 1000));
  if (!linkB.ok) throw Error("setup");
  await confirmSignInLink(h.db, linkA.token, t0);
  await confirmSignInLink(h.db, linkB.token, new Date(t0.getTime() + 1000));

  const redeemA = await request(port, "POST", "/api/auth/signin-link/redeem", {
    body: { token: linkA.token }
  });
  const redeemB = await request(port, "POST", "/api/auth/signin-link/redeem", {
    body: { token: linkB.token }
  });
  expect(redeemA.status).toBe(200);
  expect(redeemB.status).toBe(200);

  // Admin session created directly via service layer; token used as bearer.
  const { createSession } = await import("../src/identity/sessions.js");
  const adminSession = await createSession(h.db, adminId, "admin", t0);

  return {
    port,
    userACookie: sessionCookie(redeemA),
    userBCookie: sessionCookie(redeemB),
    adminCookie: `cp_session=${encodeURIComponent(adminSession.token)}`,
    accountA: invA.accountId,
    accountB: invB.accountId
  };
}

describe("deny-by-default isolation", () => {
  it("unauthenticated requests are denied on every protected resource type", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      for (const resource of RESOURCES) {
        const res = await request(users.port, "GET", `/api/account/${users.accountA}/${resource}`);
        expect(res.status).toBe(401);
      }
    });
  });

  it("cross-account access returns denial for every protected resource type (T2.6 AC)", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      for (const resource of RESOURCES) {
        // B attempting to read A's resources.
        const res = await request(
          users.port,
          "GET",
          `/api/account/${users.accountA}/${resource}`,
          { cookie: users.userBCookie }
        );
        expect(res.status).toBe(404); // existence not disclosed
        expect(res.body).toEqual({ error: "not_found" });
      }
    });
  });

  it("owners can read their own resources", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      for (const resource of RESOURCES) {
        const res = await request(
          users.port,
          "GET",
          `/api/account/${users.accountA}/${resource}`,
          { cookie: users.userACookie }
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ accountId: users.accountA });
      }
    });
  });

  it("administrators have no routine access to user content (least privilege)", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      for (const resource of RESOURCES) {
        const res = await request(
          users.port,
          "GET",
          `/api/account/${users.accountA}/${resource}`,
          { cookie: users.adminCookie }
        );
        expect(res.status).toBe(404);
      }
    });
  });

  it("non-administrators are denied administrative functions", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      const res = await request(users.port, "POST", "/api/admin/invitations", {
        cookie: users.userACookie,
        body: { email: "victim@example.invalid" }
      });
      expect(res.status).toBe(403);
    });
  });

  it("revoked sessions fail closed immediately", async () => {
    await withServer(h.app, async (port) => {
      const users = await setupUsers(port);
      const logout = await request(users.port, "POST", "/api/auth/logout", {
        cookie: users.userACookie
      });
      expect(logout.status).toBe(200);
      const afterLogout = await request(users.port, "GET", "/api/me", {
        cookie: users.userACookie
      });
      expect(afterLogout.status).toBe(401);
    });
  });
});

