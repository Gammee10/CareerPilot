-- Bootstrap the FIRST administrator(s). See ops/bootstrap-admin.md.
-- Usage: psql -v target_email='operator@example.invalid' -f bootstrap-admin.sql
-- Never use for routine role changes; those require dual control via the API.

BEGIN;

UPDATE accounts
   SET is_admin = true, updated_at = now()
 WHERE email = :'target_email'
   AND state = 'active'
   AND is_admin = false;

-- Refuse silent no-op execution: if nothing changed, abort so the operator notices.
DO $$
BEGIN
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bootstrap: target account not found, not active, or already admin';
  END IF;
END $$;

INSERT INTO audit_events (actor_type, action, outcome, target_category, target_id, details)
SELECT 'system', 'admin_role.bootstrap', 'success', 'account', a.id::text,
       jsonb_build_object('procedure', 'ops/bootstrap-admin.md')
  FROM accounts a WHERE a.email = :'target_email';

COMMIT;
