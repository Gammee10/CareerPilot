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
import {
  MANUAL_REFRESH_MIN_INTERVAL_HOURS,
  requestDiscoveryRun
} from "./discovery/orchestrator.js";
import { evaluateJobForUser } from "./evaluation/engine.js";
import {
  listJobsForDashboard,
  getJobDetail,
  transitionReview
} from "./dashboard/jobs.js";
import {
  acknowledgeDisclosure,
  closureStatus,
  confirmClosureLink,
  hasAcknowledged,
  redeemClosureConfirmation,
  requestClosureConfirmation
} from "./identity/closure.js";
import {
  getSearchStrategy,
  updateSearchStrategy
} from "./profile/searchStrategy.js";

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
      // FR-0a gate: contextual pre-upload disclosure must be acknowledged.
      if (!(await hasAcknowledged(db, req.auth!.accountId, "resume_ai_processing"))) {
        res.status(403).json({
          error: "disclosure_required",
          disclosureKey: "resume_ai_processing"
        });
        return;
      }
      const grant = await createUploadGrant(db, req.auth!.accountId, nowFn());
      res.status(201).json({ token: grant.token, expiresAt: grant.expiresAt.toISOString() });
    }
  );

  // ------------------------------------------------------------------
  // Disclosures (FR-0a/ADR-035).
  // ------------------------------------------------------------------

  app.get(
    "/api/account/:accountId/disclosures",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const keys = ["activation_notice", "resume_ai_processing"];
      const out: Record<string, boolean> = {};
      for (const k of keys) {
        out[k] = await hasAcknowledged(db, req.auth!.accountId, k);
      }
      res.json({ acknowledgements: out });
    }
  );

  app.post(
    "/api/account/:accountId/disclosures/acknowledge",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const key = String(req.body?.disclosureKey ?? "");
      if (!["activation_notice", "resume_ai_processing"].includes(key)) {
        res.status(422).json({ error: "invalid_disclosure_key" });
        return;
      }
      await acknowledgeDisclosure(db, req.auth!.accountId, key, nowFn());
      res.status(200).json({ status: "acknowledged", disclosureKey: key });
    }
  );

  // ------------------------------------------------------------------
  // Jobs dashboard surface (T7.2/T7.3) — user-scoped, ownership-guarded.
  // ------------------------------------------------------------------

  app.get(
    "/api/account/:accountId/jobs",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const jobs = await listJobsForDashboard(db, req.auth!.accountId);
      res.json({ jobs });
    }
  );

  app.get(
    "/api/account/:accountId/jobs/:jobId/detail",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const detail = await getJobDetail(db, req.auth!.accountId, String(req.params.jobId));
      if (!detail) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(detail);
    }
  );

  app.post(
    "/api/account/:accountId/jobs/:jobId/review",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const state = String(req.body?.state ?? "");
      if (!["seen", "saved", "not_interested"].includes(state)) {
        res.status(422).json({ error: "invalid_state" });
        return;
      }
      const result = await transitionReview(
        db,
        req.auth!.accountId,
        String(req.params.jobId),
        state,
        nowFn()
      );
      if (!result.ok) {
        res.status(result.reason === "job_not_found" ? 404 : 409).json({ error: result.reason });
        return;
      }
      res.status(200).json({ state: result.state });
    }
  );

  app.post(
    "/api/account/:accountId/jobs/:jobId/evaluate",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await evaluateJobForUser(
        db,
        req.auth!.accountId,
        String(req.params.jobId),
        nowFn(),
        ai
      );
      if (!result.ok) {
        res.status(404).json({ error: result.reason });
        return;
      }
      res.status(result.ok ? 200 : 500).json({
        evaluationId: result.evaluationId,
        eligibility: result.eligibility,
        aiUsed: result.aiUsed
      });
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
  // Discovery status + manual refresh (FR-9/10, ADR-042/043 truthfulness).
  // ------------------------------------------------------------------

  app.post(
    "/api/account/:accountId/discovery/refresh",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await requestDiscoveryRun(
        db,
        req.auth!.accountId,
        "manual",
        nowFn(),
        { manualMinIntervalHours: MANUAL_REFRESH_MIN_INTERVAL_HOURS }
      );
      switch (result.outcome) {
        case "started":
          res.status(202).json({ state: "started", runId: result.runId });
          break;
        case "queued_followup":
          res.status(202).json({ state: "queued_followup", runId: result.runId });
          break;
        case "coalesced":
          res.status(200).json({ state: "coalesced", runId: result.runId });
          break;
        case "rejected_min_interval":
          // Truthful rejection with the real next-eligible time (FR-9).
          res.status(200).json({
            state: "rejected_min_interval",
            nextEligibleAt: result.nextEligibleAt.toISOString()
          });
          break;
        case "account_inactive":
          res.status(409).json({ error: "account_inactive" });
          break;
      }
    }
  );

  app.get(
    "/api/account/:accountId/discovery/status",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const run = await db.query(
        `SELECT id, trigger_source, coalesced_reasons, status, started_at, completed_at
           FROM discovery_runs WHERE account_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [req.auth!.accountId]
      );
      if (run.rows.length === 0) {
        res.status(404).json({ error: "no_runs" });
        return;
      }
      const attempts = await db.query(
        `SELECT DISTINCT ON (job_source_slug)
                job_source_slug, status, observation_count, finished_at
           FROM source_collection_attempts
          WHERE discovery_run_id = $1
          ORDER BY job_source_slug, started_at DESC`,
        [run.rows[0].id]
      );
      res.json({ run: run.rows[0], attempts: attempts.rows });
    }
  );

  // ------------------------------------------------------------------
  // Search strategy controls (T7.6, FR-11–13).
  // ------------------------------------------------------------------

  app.get(
    "/api/account/:accountId/search-strategy",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const strategy = await getSearchStrategy(db, req.auth!.accountId);
      res.json(strategy);
    }
  );

  app.put(
    "/api/account/:accountId/search-strategy",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const body = req.body ?? {};
      await updateSearchStrategy(
        db,
        req.auth!.accountId,
        {
          terms: Array.isArray(body.terms) ? body.terms : undefined,
          enableGenerated: Array.isArray(body.enableGenerated) ? body.enableGenerated : undefined,
          sourceTargeting:
            typeof body.sourceTargeting === "object" && body.sourceTargeting !== null
              ? body.sourceTargeting
              : undefined,
          disabledSources: Array.isArray(body.disabledSources) ? body.disabledSources : undefined
        },
        nowFn()
      );
      const strategy = await getSearchStrategy(db, req.auth!.accountId);
      res.json(strategy);
    }
  );

  // ------------------------------------------------------------------
  // Account closure (T7.5, FR-0b/ADR-036).
  // ------------------------------------------------------------------

  app.post(
    "/api/account/:accountId/closure/request",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      const result = await requestClosureConfirmation(db, req.auth!.accountId, nowFn());
      if ("error" in result) {
        res.status(409).json({ error: result.error });
        return;
      }
      const emailRow = await db.query<{ email: string }>(
        "SELECT email::text AS email FROM accounts WHERE id = $1",
        [req.auth!.accountId]
      );
      await mailer.sendClosureConfirmation(
        emailRow.rows[0].email,
        `${config.publicUrl}/closure?token=${encodeURIComponent(result.token)}`
      );
      res.status(202).json({ state: "confirmation_sent" });
    }
  );

  app.get(
    "/api/account/:accountId/closure/status",
    requireSession(db, nowFn),
    requireSelf("accountId"),
    async (req, res) => {
      res.json(await closureStatus(db, req.auth!.accountId));
    }
  );

  // Public two-step closure confirmation via the FRESH purpose-bound link.
  app.post("/api/auth/closure/confirm", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const ok = token ? await confirmClosureLink(db, token, nowFn()) : false;
    if (!ok) {
      res.status(400).json({ error: "invalid_link" });
      return;
    }
    res.status(200).json({ status: "confirmed" });
  });

  app.post("/api/auth/closure/redeem", async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const result = token ? await redeemClosureConfirmation(db, token, nowFn()) : { ok: false as const };
    if (!result.ok) {
      res.status(400).json({ error: "invalid_link" });
      return;
    }
    res.status(200).json({
      status: "closed",
      deletionNotice: "Access is blocked and user data will be deleted within 30 days."
    });
  });

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
