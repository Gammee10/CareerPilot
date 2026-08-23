// Adapter registry with independent enable/disable (ADR-059). A disabled
// source performs ZERO network requests — checked before any transport use.
import type { Pool } from "pg";
import { greenhouseAdapter, leverAdapter, remoteokAdapter, type Adapter } from "./adapters.js";
import type { SourceSlug } from "./contract.js";

export function buildAdapter(slug: SourceSlug, config: Record<string, string>): Adapter {
  switch (slug) {
    case "greenhouse":
      return greenhouseAdapter({ boardToken: config.boardToken ?? "" });
    case "lever":
      return leverAdapter({ site: config.site ?? "" });
    case "remoteok":
      return remoteokAdapter();
  }
}

export type CollectionGate =
  | { allowed: true }
  | { allowed: false; reason: "unknown_source" | "disabled" | "terms_not_validated" };

export async function checkCollectionAllowed(
  db: Pool,
  slug: SourceSlug
): Promise<CollectionGate> {
  const row = await db.query<{ enabled: boolean; terms_validation_recorded_at: Date | null }>(
    "SELECT enabled, terms_validation_recorded_at FROM job_sources WHERE slug = $1",
    [slug]
  );
  if (row.rows.length === 0) return { allowed: false, reason: "unknown_source" };
  // T4.0 precondition: no collection before recorded terms validation.
  if (row.rows[0].terms_validation_recorded_at === null) {
    return { allowed: false, reason: "terms_not_validated" };
  }
  if (!row.rows[0].enabled) return { allowed: false, reason: "disabled" };
  return { allowed: true };
}
