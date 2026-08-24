-- Deletion-replay step for the restore drill (ADR-024/057).
--
-- Precondition: the driver has populated the TEMP table
--   replay_audit_events(target_id text, occurred_at timestamptz)
-- with post-backup account-closure audit records exported from the live
-- system (the restored snapshot cannot contain them).
--
-- Effect: closure decisions newer than the backup point are RE-APPLIED to
-- the restored copy, and any sessions in it are terminated.

BEGIN;

UPDATE accounts a
   SET state = 'closed',
       closed_at = COALESCE(a.closed_at, ev.occurred_at),
       updated_at = now()
  FROM (
    SELECT DISTINCT ON (r.target_id)
           r.target_id::uuid AS account_id, r.occurred_at
      FROM replay_audit_events r
     WHERE r.occurred_at > :'backup_ts'::timestamptz
     ORDER BY r.target_id, r.occurred_at DESC
  ) ev
 WHERE a.id = ev.account_id
   AND a.state <> 'closed';

UPDATE sessions s
   SET revoked_at = now()
  FROM accounts a
 WHERE a.id = s.account_id
   AND a.state = 'closed'
   AND s.revoked_at IS NULL;

COMMIT;
