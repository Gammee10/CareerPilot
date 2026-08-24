// Category-based retention enforcement (T8.5, ADRs 019–021).
// Every delete runs inside a transaction marked `app.retention_sweep = 'on'`
// so the append-only triggers permit it (see migration 0001).
import type { Pool } from "pg";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionResults = {
  resumeGraceMarked: number;
  sharedObservationsDeleted: number;
  availabilityDeleted: number;
  auditDeleted: number;
  exceptionalAccessDeleted: number;
};

async function sweepStatement(
  db: Pool,
  sql: string,
  params: unknown[]
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.retention_sweep = 'on'");
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return res.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function runRetentionSweep(db: Pool, now: Date): Promise<RetentionResults> {
  // Resume grace (ADR-020): replaced/removed raw resumes are soft-marked for
  // deletion after their 30-day grace. Objects themselves are purged by the
  // artifact sweeper using deleted_at.
  const resumeGraceMarked = await sweepStatement(
    db,
    `UPDATE resume_documents SET deleted_at = $2
      WHERE deleted_at IS NULL AND superseded_at IS NOT NULL
        AND superseded_at <= $1`,
    [new Date(now.getTime() - 30 * DAY_MS), now]
  );

  // Shared job data (ADR-021): observations + availability older than 180 days.
  const sharedCutoff = new Date(now.getTime() - 180 * DAY_MS);
  const availabilityDeleted = await sweepStatement(
    db,
    `DELETE FROM availability_history WHERE recorded_at < $1`,
    [sharedCutoff]
  );
  const sharedObservationsDeleted = await sweepStatement(
    db,
    `DELETE FROM source_listing_observations WHERE observed_at < $1`,
    [sharedCutoff]
  );

  // Routine audit events: 12 months (ADR-021).
  const auditDeleted = await sweepStatement(
    db,
    `DELETE FROM audit_events WHERE occurred_at < $1`,
    [new Date(now.getTime() - 365 * DAY_MS)]
  );

  // Exceptional-access records: 24 months (ADR-021).
  const exceptionalAccessDeleted = await sweepStatement(
    db,
    `DELETE FROM exceptional_access_requests WHERE requested_at < $1`,
    [new Date(now.getTime() - 730 * DAY_MS)]
  );

  return {
    resumeGraceMarked,
    sharedObservationsDeleted,
    availabilityDeleted,
    auditDeleted,
    exceptionalAccessDeleted
  };
}
