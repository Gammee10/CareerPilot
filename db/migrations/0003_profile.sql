-- CareerPilot — profile & resume processing extension (Phase 3: T3.1–T3.4)
-- Short-lived scoped artifact authorizations (ADR-050). Tokens hash-only.

CREATE TABLE resume_upload_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('upload','download')),
  resume_document_id uuid REFERENCES resume_documents(id), -- download grants only
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX resume_upload_grants_account_idx ON resume_upload_grants(account_id);

-- Extraction runs are idempotent work units (ADR-045); outcomes land in
-- resume_extraction_drafts. No authoritative AI-request record is kept
-- (AI Processing Requests are ephemeral by domain-model definition).
