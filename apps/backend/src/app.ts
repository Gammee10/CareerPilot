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

export type AppDeps = {
  db: Pool;
  mailer: Mailer;
  now?: () => Date;
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
