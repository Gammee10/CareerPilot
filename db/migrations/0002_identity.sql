-- CareerPilot — identity extension (Phase 2: T2.1–T2.5)
-- Invitations/sign-in links per ADRs 018/025/026; admin authority per ADR-031.
-- Tokens are opaque; only SHA-256 hashes are persisted.

ALTER TABLE accounts ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- One-time passwordless sign-in links (ADR-018/026).
-- confirmed_at records the confirmation-before-redemption step;
-- redeemed_at is set only on actual redemption (single use);
-- invalidated_at marks supersession by a newer link for the same email.
CREATE TABLE signin_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  email citext NOT NULL,
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  redeemed_at timestamptz,
  invalidated_at timestamptz
);
CREATE INDEX signin_links_email_idx ON signin_links(email, issued_at);
