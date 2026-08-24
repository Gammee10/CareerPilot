-- CareerPilot — dashboard support (Phase 7: T7.1–T7.6)

-- Purpose-tagged sign-in links: account closure requires a FRESH,
-- purpose-bound, single-use confirmation link (FR-0b/ADR-036).
ALTER TABLE signin_links ADD COLUMN purpose text NOT NULL DEFAULT 'signin'
  CHECK (purpose IN ('signin', 'closure_confirm'));

-- Layered data-use disclosure acknowledgements (FR-0a/ADR-035).
CREATE TABLE disclosure_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  disclosure_key text NOT NULL CHECK (disclosure_key IN
    ('activation_notice', 'resume_ai_processing')),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, disclosure_key)
);

-- Related-role expansion transparency for generated search terms (FR-13).
ALTER TABLE search_terms ADD COLUMN expanded_from text;
