// Deny-by-default authentication and resource-level authorization
// middleware (ADR-016).
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { validateSession } from "../identity/sessions.js";

export type AuthContext = {
  accountId: string;
  role: "user" | "admin";
  isAdminAccount: boolean;
  sessionId: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function extractSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "cp_session") return decodeURIComponent(rest.join("="));
    }
  }
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return null;
}

export function requireSession(db: Pool, nowFn: () => Date) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractSessionToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const result = await validateSession(db, token, nowFn());
    if (!result.ok) {
      // Expired/revoked sessions get the same treatment as missing ones.
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const account = await db.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM accounts WHERE id = $1",
      [result.session.account_id]
    );
    req.auth = {
      accountId: result.session.account_id,
      role: result.session.role,
      isAdminAccount: account.rows[0]?.is_admin === true,
      sessionId: result.session.id
    };
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.isAdminAccount || req.auth.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// Resource-level ownership check (ADR-016): a user may access only their own
// account-scoped records. Administrators have NO routine access to user
// content either — least privilege applies to the whole user-content surface.
export function requireSelf(accountIdParam: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requested = String(req.params[accountIdParam]);
    if (!req.auth || req.auth.accountId !== requested) {
      // 404 rather than 403 to avoid revealing existence of others' resources.
      res.status(404).json({ error: "not_found" });
      return;
    }
    next();
  };
}
