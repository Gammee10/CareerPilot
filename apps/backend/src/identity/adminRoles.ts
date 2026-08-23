// Dual-controlled administrator-role lifecycle (ADR-031).
import type { Pool } from "pg";
import { recordAudit } from "./audit.js";

export type RoleChangeRow = {
  id: string;
  target_account_id: string;
  action: "grant" | "revoke";
  initiated_by_account_id: string;
  approved_by_account_id: string | null;
  status: "pending" | "approved" | "rejected" | "executed";
};

export type InitiateResult =
  | { ok: true; changeId: string }
  | { ok: false; reason: "not_admin" | "target_missing" };

export async function initiateRoleChange(
  db: Pool,
  initiatorAccountId: string,
  targetAccountId: string,
  action: "grant" | "revoke",
  _now: Date
): Promise<InitiateResult> {
  const initiator = await db.query<{ is_admin: boolean; state: string }>(
    "SELECT is_admin, state FROM accounts WHERE id = $1",
    [initiatorAccountId]
  );
  if (!initiator.rows[0]?.is_admin || initiator.rows[0].state !== "active") {
    return { ok: false, reason: "not_admin" };
  }
  const target = await db.query<{ id: string }>(
    "SELECT id FROM accounts WHERE id = $1",
    [targetAccountId]
  );
  if (target.rows.length === 0) return { ok: false, reason: "target_missing" };

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO administrator_role_changes
       (target_account_id, action, initiated_by_account_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [targetAccountId, action, initiatorAccountId]
  );
  await recordAudit(db, {
    actorType: "admin",
    actorAccountId: initiatorAccountId,
    action: "admin_role.change_initiated",
    outcome: "success",
    targetCategory: "admin_role_change",
    targetId: inserted.rows[0].id,
    details: { change: action }
  });
  return { ok: true, changeId: inserted.rows[0].id };
}

export type ApproveResult =
  | { ok: true; executed: boolean }
  // self_approval: attempted and refused — material audit event (ADR-031).
  | { ok: false; reason: "self_approval" | "not_found" | "not_pending" | "last_admin" | "not_admin" };

export async function approveRoleChange(
  db: Pool,
  changeId: string,
  approverAccountId: string,
  now: Date
): Promise<ApproveResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const approver = await client.query<{ is_admin: boolean; state: string }>(
      "SELECT is_admin, state FROM accounts WHERE id = $1 FOR UPDATE",
      [approverAccountId]
    );
    if (!approver.rows[0]?.is_admin || approver.rows[0].state !== "active") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_admin" };
    }

    const change = await client.query<RoleChangeRow>(
      "SELECT * FROM administrator_role_changes WHERE id = $1 FOR UPDATE",
      [changeId]
    );
    const row = change.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    if (row.initiated_by_account_id === approverAccountId) {
      // Self-elevation attempt: refuse AND audit (ADR-031).
      await recordAudit(client, {
        actorType: "admin",
        actorAccountId: approverAccountId,
        action: "admin_role.self_approval_denied",
        outcome: "denied",
        targetCategory: "admin_role_change",
        targetId: changeId
      });
      await client.query("COMMIT");
      return { ok: false, reason: "self_approval" };
    }
    if (row.status !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_pending" };
    }

    // Last-admin protection: cannot remove the final active administrator.
    if (row.action === "revoke") {
      const admins = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM accounts
          WHERE is_admin = true AND state <> 'closed'`
      );
      const targetIsAdmin = await client.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM accounts WHERE id = $1",
        [row.target_account_id]
      );
      if (
        targetIsAdmin.rows[0]?.is_admin &&
        Number(admins.rows[0].n) <= 1
      ) {
        await recordAudit(client, {
          actorType: "admin",
          actorAccountId: approverAccountId,
          action: "admin_role.last_admin_protected",
          outcome: "denied",
          targetCategory: "admin_role_change",
          targetId: changeId
        });
        await client.query("COMMIT");
        return { ok: false, reason: "last_admin" };
      }
    }

    // Execute immediately upon independent approval.
    const nextAdmin =
      row.action === "grant" ? true : false;
    await client.query(
      "UPDATE accounts SET is_admin = $2, updated_at = $3 WHERE id = $1",
      [row.target_account_id, nextAdmin, now]
    );
    await client.query(
      `UPDATE administrator_role_changes
          SET status = 'executed', approved_by_account_id = $2,
              decided_at = $3, executed_at = $3
        WHERE id = $1`,
      [changeId, approverAccountId, now]
    );

    // Removing authority ends the target's privileged sessions immediately.
    if (row.action === "revoke") {
      await client.query(
        `UPDATE sessions SET revoked_at = $2
          WHERE account_id = $1 AND role = 'admin' AND revoked_at IS NULL`,
        [row.target_account_id, now]
      );
    }

    await recordAudit(client, {
      actorType: "admin",
      actorAccountId: approverAccountId,
      action:
        row.action === "grant" ? "admin_role.granted" : "admin_role.revoked",
      outcome: "success",
      targetCategory: "admin_role_change",
      targetId: changeId,
      details: { initiatedBy: row.initiated_by_account_id }
    });
    await client.query("COMMIT");
    return { ok: true, executed: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
