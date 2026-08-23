// Express application factory. Dependencies are injected so tests can drive
// the exact production route surface with a captured mailer and fixed clock.
import express, { type Express, type Request, type Response } from "express";
import type { Pool } from "pg";
import { config } from "./config.js";
import { requireAdmin, requireSelf, requireSession } from "./middleware/auth.js";
import { recordAudit } from "./identity/audit.js";
import {
  acceptInvitation,
  expireStaleInvitations,
  issueInvitation,
  revokeInvitation
} from "./identity/invitations.js";
import {
  confirmSignInLink,
  redeemSignInLink,
  requestSignInLink
} from "./identity/signinLinks.js";
import { createSession, revokeSession } from "./identity/sessions.js";
import {
  approveRoleChange,
  initiateRoleChange
} from "./identity/adminRoles.js";
import {
  closeAccount,
  restoreAccount,
  suspendAccount
} from "./identity/accounts.js";
import type { Mailer } from "./notify/mailer.js";
import { buildObjectStore, type ObjectStore } from "./storage/objectStore.js";
import { HttpAiClient, type AiClient } from "./profile/aiClient.js";
import {
  completeUpload,
  createDownloadGrant,
  createUploadGrant,
  downloadWithGrant
} from "./profile/resumes.js";
import { runExtraction } from "./profile/extraction.js";
import {
  acceptDraft,
  discardDraft,
  editDraft,
  listDrafts
} from "./profile/drafts.js";
import { getCurrentProfile, saveProfileVersion } from "./profile/profileVersions.js";

export type AppDeps = {
  db: Pool;
  mailer: Mailer;
  now?: () => Date;
  store?: ObjectStore;
  ai?: AiClient;
};

const GENERIC_LINK_FAILURE = { error: "invalid_link" };

function setSessionCookie(res: Response, token: string): void {
  const secure = config.nodeEnv === "production" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `cp_session=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Lax`
  );
}

export function buildApp(deps: AppDeps): Express {
  const { db, mailer } = deps;
  const nowFn = deps.now ?? (() => new Date());
  const store = deps.store ?? buildObjectStore();
  const ai: AiClient = deps.ai ?? new HttpAiClient(process.env.AI_INTERNAL_URL ?? "http://ai:8000");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // Liveness: process is up; no dependency checks, no sensitive detail.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness: authoritative datastore reachable.
  app.get("/readyz", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  // ------------------------------------------------------------------
  // Public authentication routes (FR-0). Every link failure returns the
  // identical generic response — no account/invitation state is disclosed.
  // ------------------------------------------------------------------

  app.post("/api/auth/signin-link", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(202).json({ status: "accepted" });
      return;
    }
    const result = await requestSignInLink(db, email, nowFn());
    if (result.ok) {
      await mailer.sendSignInLink(
        email,
        `${config.publicUrl}/signin?token=${encodeURIComponent(result.token)}`
      );
    }
    res.status(202).json({ status: "accepted" });
  });

  // Confirmation step: validates the link without consuming it or creating
  // a session (ADR-018 confirmation-before-redemption).
  app.post("/api/auth/signin-link/confirm", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const ok = token ? await confirmSignInLink(db, token, nowFn()) : false;
    if (!ok) {
      res.status(400).json(GENERIC_LINK_FAILURE);
      return;
    }
    res.status(200).json({ status: "confirmed" });
  });

  // Redemption step: consumes the link exactly once and starts a session.
  app.post("/api/auth/signin-link/redeem", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const result = token ? await redeemSignInLink(db, token, nowFn()) : { ok: false as const };
    if (!result.ok) {
      res.status(400).json(GENERIC_LINK_FAILURE);
      return;
    }
    const session = await createSession(db, result.accountId, "user", nowFn());
    setSessionCookie(res, session.token);
    res.status(200).json({ status: "authenticated" });
  });

  // Invitation acceptance = account activation + first sign-in.
  app.post("/api/auth/invitation/redeem", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const result = token ? await acceptInvitation(db, token, nowFn()) : { ok: false as const };
    if (!result.ok) {
      res.status(400).json(GENERIC_LINK_FAILURE);
      return;
    }
    const session = await createSession(db, result.accountId, "user", nowFn());
    setSessionCookie(res, session.token);
    res.status(200).json({ status: "activated" });
  });

  // ------------------------------------------------------------------
  // Authenticated user routes
  // ------------------------------------------------------------------

  app.post("/api/auth/logout", requireSession(db, nowFn), async (req, res) => {
    await revokeSession(db, req.auth!.sessionId, req.auth!.accountId, nowFn(), "logout");
    res.clearCookie("cp_session", { path: "/" });
    res.status(200).json({ status: "signed_out" });
  });

  app.get("/api/me", requireSession(db, nowFn), async (req, res) => {
    const row = await db.query<{ id: string; email: string; is_admin: boolean; state: string }>(
      "SELECT id, email::text AS email, is_admin, state FROM accounts WHERE id = $1",
      [req.auth!.accountId]
    );
    if (row.rows.length === 0 || row.rows[0].state !== "active") {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    res.json({
      accountId: row.rows[0].id,
      isAdmin: row.rows[0].is_admin
    });
  });

  // ------------------------------------------------------------------
  // User-scoped resource surface (ADR-014/016): deny-by-default,
  // resource-level ownership checks. Placeholder payloads until later
  // phases implement each capability; authorization behavior is final.
  // ------------------------------------------------------------------

  const USER_RESOURCES = [
    "profile",
    "resume",
    "search-strategy",
    "discovery-runs",
    "evaluations",
    "reviews"
  ] as const;

  for (const resource of USER_RESOURCES) {
    app.get(
      `/api/account/:accountId/${resource}`,
      requireSession(db, nowFn),
      requireSelf("accountId"),
      async (req, res) => {
        res.json({ resource, accountId: req.auth!.accountId, items: [] });
      }
    );
  }

  // ------------------------------------------------------------------
  // Profile & resume processing routes (Phase 3). Ownership-guarded;
  // artifact bytes move only through short-lived single-use grants.
  // ------------------------------------------------------------------

  app.post(
    "/api/account/:accountId/resume/upload-grant",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const grant = await createUploadGrant(db, req.auth!.accountId, nowFn());
      res.status(201).json({ token: grant.token, expiresAt: grant.expiresAt.toISOString() });
    }
  );

  // Token-scoped upload: the grant itself authorizes this request.
  app.put("/api/resume/upload/:grantToken", express.raw({ type: () => true, limit: "11mb" }), async (req, res) => {
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
    const result = await completeUpload(
      db,
      store,
      String(req.params.grantToken),
      body,
      contentType,
      nowFn()
    );
    if (!result.ok) {
      const code = result.reason === "invalid_grant" ? 403 : 415;
      res.status(code).json({ error: result.reason });
      return;
    }
    await runExtraction(db, store, ai, result.resumeDocumentId, nowFn());
    res.status(201).json({ resumeDocumentId: result.resumeDocumentId });
  });

  app.post(
    "/api/account/:accountId/resume/:documentId/download-grant",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await createDownloadGrant(
        db,
        req.auth!.accountId,
        String(req.params.documentId),
        nowFn()
      );
      if (!result.ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(201).json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
    }
  );

  app.get("/api/resume/download/:grantToken", async (req, res) => {
    const result = await downloadWithGrant(db, store, String(req.params.grantToken), nowFn());
    if (!result.ok) {
      res.status(403).json({ error: "invalid_grant" });
      return;
    }
    res.setHeader("content-type", result.contentType);
    res.status(200).send(result.body);
  });

  app.get(
    "/api/account/:accountId/resume",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const rows = await db.query(
        `SELECT id, content_type, byte_size, uploaded_at, superseded_at, deleted_at
           FROM resume_documents WHERE account_id = $1 ORDER BY uploaded_at DESC`,
        [req.auth!.accountId]
      );
      res.json({ documents: rows.rows });
    }
  );

  app.post(
    "/api/account/:accountId/resume/:documentId/extract",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await runExtraction(
        db,
        store,
        ai,
        String(req.params.documentId),
        nowFn()
      );
      if (!result.ok) {
        res.status(result.reason === "document_not_found" ? 404 : 422)
          .json({ error: result.reason });
        return;
      }
      res.status(result.reusedExisting ? 200 : 202).json({
        draftId: result.draftId,
        reusedExisting: result.reusedExisting
      });
    }
  );

  app.get(
    "/api/account/:accountId/extraction-drafts",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const drafts = await listDrafts(db, req.auth!.accountId);
      res.json({ drafts });
    }
  );

  app.patch(
    "/api/account/:accountId/extraction-drafts/:draftId",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await editDraft(
        db,
        req.auth!.accountId,
        String(req.params.draftId),
        req.body?.proposed_content,
        nowFn()
      );
      if (!result.ok) {
        const code =
          result.reason === "not_found" ? 404 :
          result.reason === "not_editable" ? 409 : 422;
        res.status(code).json({ error: result.reason });
        return;
      }
      res.status(200).json({ status: "edited" });
    }
  );

  app.post(
    "/api/account/:accountId/extraction-drafts/:draftId/accept",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await acceptDraft(db, req.auth!.accountId, String(req.params.draftId), nowFn());
      if (!result.ok) {
        const code =
          result.reason === "not_found" ? 404 :
          result.reason === "not_editable" ? 409 : 422;
        res.status(code).json({ error: result.reason });
        return;
      }
      res.status(200).json({
        profileVersionId: result.profileVersionId,
        versionNumber: result.versionNumber
      });
    }
  );

  app.post(
    "/api/account/:accountId/extraction-drafts/:draftId/discard",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const ok = await discardDraft(db, req.auth!.accountId, String(req.params.draftId), nowFn());
      if (!ok) {
        res.status(409).json({ error: "not_discardable" });
        return;
      }
      res.status(200).json({ status: "discarded" });
    }
  );

  app.post(
    "/api/account/:accountId/profile/save",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const source = req.body?.source === "extraction_draft" ? "extraction_draft" : "manual";
      const result = await saveProfileVersion(db, req.auth!.accountId, req.body?.content, source, nowFn());
      if (!result.ok) {
        res.status(422).json({ error: result.reason });
        return;
      }
      res.status(201).json({
        profileVersionId: result.profileVersionId,
        versionNumber: result.versionNumber
      });
    }
  );

  app.get(
    "/api/account/:accountId/profile/current",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const current = await getCurrentProfile(db, req.auth!.accountId);
      if (!current) {
        res.status(404).json({ error: "no_profile" });
        return;
      }
      res.json(current);
    }
  );

  app.get(
    "/api/account/:accountId/profile/versions",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const rows = await db.query(
        `SELECT id, version_number, source, saved_at FROM profile_versions
          WHERE account_id = $1 ORDER BY version_number DESC`,
        [req.auth!.accountId]
      );
      res.json({ versions: rows.rows });
    }
  );

  // ------------------------------------------------------------------
  // Administration routes (least privilege per ADR-016).
  // ------------------------------------------------------------------

  app.post("/api/admin/invitations", requireSession(db, nowFn), requireAdmin, async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      res.status(422).json({ error: "invalid_request" });
      return;
    }
    const result = await issueInvitation(db, email, req.auth!.accountId, nowFn());
    if (!result.ok) {
      res.status(409).json({ error: result.reason });
      return;
    }
    await mailer.sendInvitation(
      email,
      `${config.publicUrl}/activate?token=${encodeURIComponent(result.token)}`
    );
    res.status(201).json({
      invitationId: result.invitationId,
      expiresAt: result.expiresAt.toISOString()
    });
  });

  app.post(
    "/api/admin/invitations/:id/revoke",
    requireSession(db, nowFn),
    requireAdmin,
    async (req, res) => {
      const ok = await revokeInvitation(db, String(req.params.id), req.auth!.accountId, nowFn());
      if (!ok) {
        res.status(409).json({ error: "not_revocable" });
        return;
      }
      res.status(200).json({ status: "revoked" });
    }
  );

  app.get("/api/admin/invitations", requireSession(db, nowFn), requireAdmin, async (_req, res) => {
    await expireStaleInvitations(db, nowFn());
    const rows = await db.query(
      `SELECT id, email::text AS email, status, issued_at, expires_at
         FROM invitations ORDER BY issued_at DESC`
    );
    res.json({ invitations: rows.rows });
  });

  const accountTransitions = {
    suspend: (accountId: string, actor: string, at: Date, reason?: string) =>
      suspendAccount(db, accountId, actor, at, reason ? { reason } : undefined),
    restore: (accountId: string, actor: string, at: Date) =>
      restoreAccount(db, accountId, actor, at),
    close: (accountId: string, actor: string, at: Date, reason?: string) =>
      closeAccount(db, accountId, actor, at, reason ? { reason } : undefined)
  } as const;

  for (const [path, run] of Object.entries(accountTransitions)) {
    app.post(
      `/api/admin/accounts/:id/${path}`,
      requireSession(db, nowFn),
      requireAdmin,
      async (req, res) => {
        const reason: string | undefined =
          typeof req.body?.reason === "string" ? req.body.reason : undefined;
        if ((path === "close" || path === "suspend") &&
            (typeof reason !== "string" || reason.trim().length < 8)) {
          // Administrator suspension/closure requires a documented reason
          // (closure per ADR-025/036; suspension for containment traceability).
          res.status(422).json({ error: "reason_required" });
          return;
        }
        const result = await run(String(req.params.id), req.auth!.accountId, nowFn(), reason);
        if (!result.ok) {
          res.status(result.reason === "not_found" ? 404 : 409)
            .json({ error: result.reason });
          return;
        }
        res.status(200).json({ state: result.account.state });
      }
    );
  }

  app.post(
    "/api/admin/role-changes",
    requireSession(db, nowFn),
    requireAdmin,
    async (req, res) => {
      const action = req.body?.action;
      const targetAccountId = req.body?.targetAccountId;
      if ((action !== "grant" && action !== "revoke") || typeof targetAccountId !== "string") {
        res.status(422).json({ error: "invalid_request" });
        return;
      }
      const result = await initiateRoleChange(
        db,
        req.auth!.accountId,
        targetAccountId,
        action,
        nowFn()
      );
      if (!result.ok) {
        res.status(result.reason === "not_admin" ? 403 : 404).json({ error: result.reason });
        return;
      }
      res.status(201).json({ changeId: result.changeId });
    }
  );

  app.post(
    "/api/admin/role-changes/:id/approve",
    requireSession(db, nowFn),
    requireAdmin,
    async (req, res) => {
      const result = await approveRoleChange(
        db,
        String(req.params.id),
        req.auth!.accountId,
        nowFn()
      );
      if (!result.ok) {
        const code =
          result.reason === "self_approval" || result.reason === "last_admin" ? 409 : 403;
        res.status(code).json({ error: result.reason });
        return;
      }
      res.status(200).json({ status: "executed" });
    }
  );

  // Unknown routes fail closed.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // Error handler: never leaks internals (ADR-015).
  app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
    console.log(JSON.stringify({ event: "request_error" }));
    void err;
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });

  return app;
}

// Exported for operational audit tooling parity with service-layer writes.
export { recordAudit };
