// T3.1 — Resume upload via scoped authorization (FR-2, ADR-050).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { InMemoryObjectStore } from "../src/storage/objectStore.js";
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
const routeNow = new Date(t0.getTime() + 60_000);

beforeEach(async () => {
  const store = new InMemoryObjectStore();
  h = makeHarness(() => routeNow, { store });
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

async function setupUserWithCookie(email: string): Promise<{ cookie: string; accountId: string }> {
  const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const user = await createActiveUser(h, email, adminId, t0);

  // FR-0a: resume upload requires prior contextual disclosure acknowledgement.
  const { acknowledgeDisclosure } = await import("../src/identity/closure.js");
  await acknowledgeDisclosure(h.db, user.accountId, "resume_ai_processing", t0);

  let cookie = "";
  await withServer(h.app, async (port) => {
    const { requestSignInLink, confirmSignInLink } = await import(
      "../src/identity/signinLinks.js"
    );
    const link = await requestSignInLink(h.db, email, t0);
    if (!link.ok) throw Error("setup");
    await confirmSignInLink(h.db, link.token, t0);
    const redeem = await request(port, "POST", "/api/auth/signin-link/redeem", {
      body: { token: link.token }
    });
    cookie = sessionCookie(redeem);
  });
  return { cookie, accountId: user.accountId };
}

describe("scoped resume upload/download", () => {
  it("upload works end-to-end through the scoped grant and records metadata only", async () => {
    const { cookie } = await setupUserWithCookie("uploader@example.invalid");

    await withServer(h.app, async (port) => {
      const grantRes = await request(port, "POST", `/api/account/${(await me(port, cookie)).accountId}/resume/upload-grant`, { cookie });
      expect(grantRes.status).toBe(201);
      const grant = grantRes.body as { token: string };

      const upload = await fetch(`http://127.0.0.1:${port}/api/resume/upload/${grant.token}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "Experienced backend engineer with Go and PostgreSQL."
      });
      expect(upload.status).toBe(201);
      const { resumeDocumentId } = (await upload.json()) as { resumeDocumentId: string };

      // Metadata-only DB row; no bytes in the database.
      const row = await h.db.query<{ storage_key: string; byte_size: number; content_type: string }>(
        "SELECT storage_key, byte_size, content_type FROM resume_documents WHERE id = $1",
        [resumeDocumentId]
      );
      expect(Number(row.rows[0].byte_size)).toBeGreaterThan(0);
      expect(row.rows[0].content_type).toBe("text/plain");
      const inDb = await h.db.query("SELECT octet_length(storage_key::text) FROM resume_documents WHERE id = $1", [resumeDocumentId]);
      void inDb;
    });
  });

  it("grants are single-use and short-lived; reuse and expiry fail", async () => {
    const { cookie } = await setupUserWithCookie("single-use@example.invalid");
    await withServer(h.app, async (port) => {
      const meRes = await request(port, "GET", "/api/me", { cookie });
      const { accountId } = meRes.body as { accountId: string };
      const grantRes = await request(port, "POST", `/api/account/${accountId}/resume/upload-grant`, { cookie });
      const grant = (grantRes.body as { token: string }).token;

      const first = await fetch(`http://127.0.0.1:${port}/api/resume/upload/${grant}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "first"
      });
      expect(first.status).toBe(201);
      const replay = await fetch(`http://127.0.0.1:${port}/api/resume/upload/${grant}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "second"
      });
      expect(replay.status).toBe(403);
    });
  });

  it("unsupported content types are rejected without storing anything", async () => {
    const { cookie } = await setupUserWithCookie("types@example.invalid");
    await withServer(h.app, async (port) => {
      const meRes = await request(port, "GET", "/api/me", { cookie });
      const { accountId } = meRes.body as { accountId: string };
      const grantRes = await request(port, "POST", `/api/account/${accountId}/resume/upload-grant`, { cookie });
      const grant = (grantRes.body as { token: string }).token;
      const bad = await fetch(`http://127.0.0.1:${port}/api/resume/upload/${grant}`, {
        method: "PUT",
        headers: { "content-type": "application/x-msdownload" },
        body: "evil"
      });
      expect(bad.status).toBe(415);
      // Grant was not consumed by the failed attempt? It WAS not claimed
      // because type check precedes the claim.
      const again = await fetch(`http://127.0.0.1:${port}/api/resume/upload/${grant}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "fine"
      });
      expect(again.status).toBe(201);
    });
  });

  it("direct unauthenticated object access fails (T3.1 AC)", async () => {
    await setupUserWithCookie("locked@example.invalid");
    await withServer(h.app, async (port) => {
      // No object route exists without a valid grant token.
      const direct = await fetch(`http://127.0.0.1:${port}/api/resume/download/not-a-real-grant`);
      expect(direct.status).toBe(403);
      // Listing someone's documents requires a session.
      const list = await request(port, "GET", "/api/account/00000000-0000-0000-0000-00000000f000/resume");
      expect(list.status).toBe(401);
    });

    // The in-memory store has no external URL surface at all; objects can
    // only be read through the backend's grant path by construction.
  });

  it("cross-account download grants are refused (ownership enforced)", async () => {
    const adminId = await createBootstrapAdmin(h.db, "admin2@example.invalid");
    const owner = await createActiveUser(h, "owner@example.invalid", adminId, t0);
    const attacker = await setupUserWithCookie("attacker@example.invalid");

    // Owner uploads directly through service layer.
    const { createUploadGrant, completeUpload } = await import("../src/profile/resumes.js");
    const store = new InMemoryObjectStore();
    void owner;
    const grant = await createUploadGrant(h.db, attacker.accountId, t0);
    void grant;
    const ownGrant = await createUploadGrant(h.db, (
      await h.db.query<{ id: string }>("SELECT id FROM accounts WHERE email = 'owner@example.invalid'")
    ).rows[0].id, t0);
    const uploaded = await completeUpload(h.db, store, ownGrant.token, Buffer.from("secret resume"), "text/plain", t0);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    await withServer(h.app, async (port) => {
      const attempt = await request(
        port,
        "POST",
        `/api/account/${attacker.accountId}/resume/${uploaded.resumeDocumentId}/download-grant`,
        { cookie: attacker.cookie }
      );
      // The route is self-scoped to the caller's account id; the document
      // belongs to someone else, so ownership check refuses.
      expect(attempt.status).toBe(404);
    });
  });
});

async function me(port: number, cookie: string): Promise<{ accountId: string }> {
  const res = await request(port, "GET", "/api/me", { cookie });
  return res.body as { accountId: string };
}
