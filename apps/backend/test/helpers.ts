import type { Express } from "express";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { CaptureMailer } from "../src/notify/mailer.js";
import { testDbConfig } from "./global-setup.js";

export const TEST_DB = "careerpilot_test";

export function makeTestPool(): Pool {
  return new Pool({ ...testDbConfig(), database: TEST_DB });
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE accounts, invitations, sessions, signin_links,
              administrator_role_changes, audit_events
      RESTART IDENTITY CASCADE`
  );
}

export type Harness = {
  db: Pool;
  mailer: CaptureMailer;
  app: Express;
  close: () => Promise<void>;
};

export function makeHarness(now: () => Date = () => new Date()): Harness {
  const db = makeTestPool();
  const mailer = new CaptureMailer();
  const app = buildApp({ db, mailer, now });
  return {
    db,
    mailer,
    app,
    close: () => db.end()
  };
}

// Minimal HTTP test client against an ephemeral listener.
export type TestResponse = {
  status: number;
  body: unknown;
  getHeader: (name: string) => string | string[] | undefined;
};

export async function withServer(
  app: Express,
  fn: (port: number) => Promise<void>
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function request(
  port: number,
  method: "GET" | "POST",
  pathUrl: string,
  opts?: { body?: unknown; cookie?: string }
): Promise<TestResponse> {
  const res = await fetch(`http://127.0.0.1:${port}${pathUrl}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts?.cookie ? { cookie: opts.cookie } : {})
    },
    body: opts?.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    getHeader: (name) => res.headers.get(name as string) ?? undefined
  };
}

export function sessionCookie(res: TestResponse): string {
  const setCookie = res.getHeader("set-cookie");
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Convenience: activate a user through the real invitation path.
export async function createActiveUser(
  h: Harness,
  email: string,
  adminId: string,
  now: Date
): Promise<{ accountId: string; invitationToken: string }> {
  const issue = await import("../src/identity/invitations.js");
  const result = await issue.issueInvitation(h.db, email, adminId, now);
  if (!result.ok) throw new Error("test setup: invitation failed");
  const accept = await issue.acceptInvitation(h.db, result.token, now);
  if (!accept.ok) throw new Error("test setup: acceptance failed");
  return { accountId: accept.accountId, invitationToken: result.token };
}

export async function createBootstrapAdmin(
  pool: Pool,
  email: string
): Promise<string> {
  // Mirrors ops/bootstrap-admin.sql: direct provisioning of initial authority,
  // always paired with an explicit audit record.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (email, state, is_admin)
     VALUES ($1, 'active', true) RETURNING id`,
    [email]
  );
  await pool.query(
    `INSERT INTO audit_events (actor_type, action, outcome, target_category, target_id, details)
     VALUES ('system', 'admin_role.bootstrap', 'success', 'account', $1,
             '{"procedure":"ops/bootstrap-admin.md"}')`,
    [rows[0].id]
  );
  return rows[0].id;
}
