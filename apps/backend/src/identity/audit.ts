import type { Pool, PoolClient } from "pg";

export type AuditInput = {
  actorType: "user" | "admin" | "system" | "capability";
  actorAccountId?: string | null;
  action: string;
  outcome: "success" | "failure" | "denied";
  targetCategory?: string | null;
  targetId?: string | null;
  correlationId?: string | null;
  details?: Record<string, unknown>;
};

// Audit metadata only — raw sensitive payloads (emails, token values,
// profile content) are never passed to this function (ADR-015).
export async function recordAudit(
  db: Pool | PoolClient,
  event: AuditInput
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
       (actor_type, actor_account_id, action, outcome, target_category, target_id, correlation_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.actorType,
      event.actorAccountId ?? null,
      event.action,
      event.outcome,
      event.targetCategory ?? null,
      event.targetId ?? null,
      event.correlationId ?? null,
      JSON.stringify(event.details ?? {})
    ]
  );
}
