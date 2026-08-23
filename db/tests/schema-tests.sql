-- CareerPilot — schema acceptance tests (T1.2)
-- Every assertion RAISEs on failure. Expected failures are caught locally;
-- anything else aborts via ON_ERROR_STOP and fails the suite.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Seed minimal reference data (committed independently of test DO blocks)
-- ---------------------------------------------------------------------------

INSERT INTO accounts(email, state) VALUES ('t1-a@example.invalid', 'active')
  ON CONFLICT DO NOTHING;

INSERT INTO canonical_jobs(id) VALUES ('00000000-0000-0000-0000-00000000d001')
  ON CONFLICT DO NOTHING;

INSERT INTO job_sources(slug) VALUES ('greenhouse') ON CONFLICT DO NOTHING;

WITH a AS (SELECT id FROM accounts WHERE email = 't1-a@example.invalid')
INSERT INTO profile_versions(account_id, version_number, source, content)
SELECT a.id, 1, 'manual', '{"note":"seed"}'::jsonb FROM a;

WITH pv AS (
  SELECT pv.id FROM profile_versions pv
  JOIN accounts a ON a.id = pv.account_id AND pv.version_number = 1
  WHERE a.email = 't1-a@example.invalid'
), a AS (SELECT id FROM accounts WHERE email = 't1-a@example.invalid')
INSERT INTO evaluations(account_id, canonical_job_id, profile_version_id,
                        matching_policy_version, outcome, eligibility)
SELECT a.id, '00000000-0000-0000-0000-00000000d001', pv.id, 'test-policy-1',
       'succeeded', 'unverified'
FROM a CROSS JOIN pv;

INSERT INTO source_listings(id, job_source_slug, external_listing_key)
VALUES ('00000000-0000-0000-0000-00000000e001', 'greenhouse', 'test-key-1')
  ON CONFLICT DO NOTHING;

INSERT INTO source_listing_observations(source_listing_id, availability_signal,
                                        content_hash, provenance)
VALUES ('00000000-0000-0000-0000-00000000e001', 'active', 'seed-hash-1',
        '{"seed":true}'::jsonb);

INSERT INTO availability_history(canonical_job_id, state, reason)
VALUES ('00000000-0000-0000-0000-00000000d001', 'active', 'observation_active');

INSERT INTO audit_events(actor_type, action, outcome)
VALUES ('system', 'schema_test.seed', 'success');

-- ---------------------------------------------------------------------------
-- 1. Append-only tables reject UPDATE (AGENTS.md invariant 7)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  UPDATE profile_versions SET content = '{"tampered":true}'::jsonb;
  RAISE EXCEPTION 'FAIL: profile_versions accepted UPDATE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE evaluations SET score = 100;
  RAISE EXCEPTION 'FAIL: evaluations accepted UPDATE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE source_listing_observations SET provenance = '{"tampered":true}'::jsonb;
  RAISE EXCEPTION 'FAIL: source_listing_observations accepted UPDATE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE availability_history SET state = 'active';
  RAISE EXCEPTION 'FAIL: availability_history accepted UPDATE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE audit_events SET action = 'tampered';
  RAISE EXCEPTION 'FAIL: audit_events accepted UPDATE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Append-only tables reject DELETE outside the retention sweep
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  DELETE FROM profile_versions;
  RAISE EXCEPTION 'FAIL: profile_versions accepted DELETE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM evaluations;
  RAISE EXCEPTION 'FAIL: evaluations accepted DELETE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM source_listing_observations;
  RAISE EXCEPTION 'FAIL: source_listing_observations accepted DELETE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM availability_history;
  RAISE EXCEPTION 'FAIL: availability_history accepted DELETE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM audit_events;
  RAISE EXCEPTION 'FAIL: audit_events accepted DELETE';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Retention sweep CAN delete when explicitly marked (ADRs 020/021)
--    The sweep runs in a rolled-back transaction so seeds stay intact.
-- ---------------------------------------------------------------------------

BEGIN;
SET LOCAL app.retention_sweep = 'on';
DELETE FROM audit_events;
-- The sweep must actually remove rows (a returning-NULL trigger would
-- silently cancel the delete and leave the count unchanged).
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM audit_events;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: retention-sweep delete removed no rows (count=%)', n; END IF;
END $$;
ROLLBACK;

-- After the rollback, seeded rows must still exist and mutation stays banned.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM profile_versions;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL: retention-sweep trial was not rolled back'; END IF;
  SELECT count(*) INTO n FROM audit_events;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL: retention sweep did not restore rows on rollback'; END IF;
END $$;

DO $$
BEGIN
  DELETE FROM profile_versions;
  RAISE EXCEPTION 'FAIL: append-only delete accepted after sweep trial';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Lifecycle check constraints
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO accounts(email, state) VALUES ('bad-state@example.invalid', 'paused');
  RAISE EXCEPTION 'FAIL: invalid account state accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

DO $$
BEGIN
  INSERT INTO invitations(email, token_hash, status, expires_at)
  VALUES ('x@example.invalid', 'h1', 'pending', now() + interval '14 days');
  RAISE EXCEPTION 'FAIL: invalid invitation status accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

DO $$
BEGIN
  INSERT INTO user_job_reviews(account_id, canonical_job_id, state)
  SELECT id, '00000000-0000-0000-0000-00000000d001', 'archived'
  FROM accounts WHERE email = 't1-a@example.invalid';
  RAISE EXCEPTION 'FAIL: invalid review state accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

DO $$
BEGIN
  INSERT INTO availability_history(canonical_job_id, state, reason)
  VALUES ('00000000-0000-0000-0000-00000000d001', 'gone', 'explicit_closed');
  RAISE EXCEPTION 'FAIL: invalid availability state accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Governance constraints
-- ---------------------------------------------------------------------------

-- Dual control: self-approval impossible (ADR-031).
DO $$
DECLARE me uuid;
BEGIN
  SELECT id INTO me FROM accounts WHERE email = 't1-a@example.invalid';
  INSERT INTO administrator_role_changes(
      target_account_id, action, initiated_by_account_id, approved_by_account_id)
  VALUES (me, 'grant', me, me);
  RAISE EXCEPTION 'FAIL: self-approval accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Account closure consistency: closed requires timestamp.
DO $$
BEGIN
  INSERT INTO accounts(email, state) VALUES ('closed-bad@example.invalid', 'closed');
  RAISE EXCEPTION 'FAIL: closed account without closed_at accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Discovery-run coalescing: one active run per user (ADR-042)
-- ---------------------------------------------------------------------------

DO $$
DECLARE acct uuid; pv uuid; r1 uuid;
BEGIN
  SELECT id INTO acct FROM accounts WHERE email = 't1-a@example.invalid';
  SELECT id INTO pv FROM profile_versions
   WHERE account_id = acct AND version_number = 1;
  INSERT INTO discovery_runs(account_id, profile_version_id, trigger_source)
    VALUES (acct, pv, 'scheduled') RETURNING id INTO r1;
  BEGIN
    INSERT INTO discovery_runs(account_id, profile_version_id, trigger_source)
      VALUES (acct, pv, 'manual');
    RAISE EXCEPTION 'FAIL: second active discovery run accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  DELETE FROM discovery_runs WHERE id = r1;  -- cleanup for later assertions
END $$;

-- A completed run does not block a new active run.
DO $$
DECLARE acct uuid; pv uuid; n integer;
BEGIN
  SELECT id INTO acct FROM accounts WHERE email = 't1-a@example.invalid';
  SELECT id INTO pv FROM profile_versions
   WHERE account_id = acct AND version_number = 1;
  INSERT INTO discovery_runs(account_id, profile_version_id, trigger_source, status)
    VALUES (acct, pv, 'scheduled', 'complete');
  INSERT INTO discovery_runs(account_id, profile_version_id, trigger_source)
    VALUES (acct, pv, 'manual');
  SELECT count(*) INTO n FROM discovery_runs
   WHERE account_id = acct AND status IN ('queued','running');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected exactly 1 active run, got %', n; END IF;
  DELETE FROM discovery_runs WHERE account_id = acct;  -- cleanup
END $$;

-- ---------------------------------------------------------------------------
-- 7. Observation idempotency guard (ADR-044/045: retries don't duplicate)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO source_listing_observations(source_listing_id, content_hash, provenance)
  VALUES ('00000000-0000-0000-0000-00000000e001', 'seed-hash-1', '{"dup":true}'::jsonb);
  RAISE EXCEPTION 'FAIL: duplicate observation accepted (idempotency guard missing)';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

\echo 'ALL SCHEMA TESTS PASSED'
