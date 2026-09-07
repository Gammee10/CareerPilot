// Search strategy controls (T7.6, FR-11–13): view/edit/disable terms,
// source targeting, and transparency of related-role expansion.
import type { Pool } from "pg";

export type StrategyTerm = {
  term: string;
  origin: "generated" | "user_edited";
  enabled: boolean;
  expandedFrom: string | null;
};

export async function getSearchStrategy(
  db: Pool,
  accountId: string
): Promise<{
  terms: StrategyTerm[];
  sourceTargeting: Record<string, unknown>;
  disabledSources: string[];
  transparencyNotice: string;
}> {
  const strategy = await db.query<{ source_targeting: Record<string, unknown>; disabled_sources: string[] }>(
    "SELECT source_targeting, disabled_sources FROM search_strategy WHERE account_id = $1",
    [accountId]
  );
  const terms = await db.query<{
    term: string;
    origin: string;
    enabled: boolean;
    expanded_from: string | null;
  }>(
    `SELECT term, origin, enabled, expanded_from FROM search_terms
      WHERE account_id = $1 ORDER BY created_at`,
    [accountId]
  );

  return {
    // FR-13 transparency: users can see which generated terms came from
    // related-role expansion and disable any of them.
    transparencyNotice:
      "Generated search terms may include related roles discovered from your target role. " +
      "Generated terms are marked and can be disabled individually.",
    terms: terms.rows.map((t) => ({
      term: t.term,
      origin: t.origin as StrategyTerm["origin"],
      enabled: t.enabled,
      expandedFrom: t.expanded_from
    })),
    sourceTargeting: strategy.rows[0]?.source_targeting ?? {},
    disabledSources: strategy.rows[0]?.disabled_sources ?? []
  };
}

export type UpdateStrategyInput = {
  terms?: Array<{ term: string; origin?: string; enabled?: boolean; expandedFrom?: string | null }>;
  enableGenerated?: Array<{ term: string; enabled: boolean }>;
  sourceTargeting?: Record<string, unknown>;
  disabledSources?: string[];
};

// Adapter slugs accepted in disabledSources (matches the job_sources CHECK
// constraint; url_import included — a user may disable URL imports too).
const KNOWN_SOURCE_SLUGS = new Set(["greenhouse", "lever", "remoteok", "url_import"]);

const MAX_TERMS = 100;
const MAX_TERM_LENGTH = 200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateInput(input: UpdateStrategyInput): { ok: true } | { ok: false; reason: string } {
  if (input.terms !== undefined) {
    if (!Array.isArray(input.terms) || input.terms.length > MAX_TERMS) {
      return { ok: false, reason: "invalid_terms" };
    }
    for (const t of input.terms) {
      if (
        !isPlainObject(t) ||
        typeof t.term !== "string" || t.term.length === 0 || t.term.length > MAX_TERM_LENGTH ||
        (t.origin !== undefined && t.origin !== "generated" && t.origin !== "user_edited") ||
        (t.enabled !== undefined && typeof t.enabled !== "boolean") ||
        (t.expandedFrom !== undefined && t.expandedFrom !== null && typeof t.expandedFrom !== "string")
      ) {
        return { ok: false, reason: "invalid_terms" };
      }
      if (typeof t.expandedFrom === "string" && t.expandedFrom.length > MAX_TERM_LENGTH) {
        return { ok: false, reason: "invalid_terms" };
      }
    }
  }
  if (input.enableGenerated !== undefined) {
    if (!Array.isArray(input.enableGenerated) || input.enableGenerated.length > MAX_TERMS) {
      return { ok: false, reason: "invalid_enable_generated" };
    }
    for (const g of input.enableGenerated) {
      if (
        !isPlainObject(g) ||
        typeof g.term !== "string" || g.term.length === 0 || g.term.length > MAX_TERM_LENGTH ||
        typeof g.enabled !== "boolean"
      ) {
        return { ok: false, reason: "invalid_enable_generated" };
      }
    }
  }
  if (input.sourceTargeting !== undefined) {
    if (!isPlainObject(input.sourceTargeting)) {
      return { ok: false, reason: "invalid_source_targeting" };
    }
    const keys = Object.keys(input.sourceTargeting);
    if (keys.length > 50) return { ok: false, reason: "invalid_source_targeting" };
    try {
      const serialized = JSON.stringify(input.sourceTargeting);
      if (serialized.length > 10 * 1024) return { ok: false, reason: "invalid_source_targeting" };
    } catch {
      return { ok: false, reason: "invalid_source_targeting" };
    }
  }
  if (input.disabledSources !== undefined) {
    if (
      !Array.isArray(input.disabledSources) ||
      input.disabledSources.length > 10 ||
      input.disabledSources.some((s) => typeof s !== "string" || !KNOWN_SOURCE_SLUGS.has(s))
    ) {
      return { ok: false, reason: "invalid_disabled_sources" };
    }
  }
  return { ok: true };
}

export async function updateSearchStrategy(
  db: Pool,
  accountId: string,
  input: UpdateStrategyInput,
  now: Date
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // M4: partial updates preserve unspecified fields. Read the stored row
    // first and merge — a {terms}-only PUT must not wipe source targeting.
    const current = await client.query<{
      source_targeting: Record<string, unknown>;
      disabled_sources: string[];
    }>(
      "SELECT source_targeting, disabled_sources FROM search_strategy WHERE account_id = $1",
      [accountId]
    );
    const sourceTargeting = input.sourceTargeting ?? current.rows[0]?.source_targeting ?? {};
    const disabledSources = input.disabledSources ?? current.rows[0]?.disabled_sources ?? [];

    await client.query(
      `INSERT INTO search_strategy (account_id, source_targeting, disabled_sources, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (account_id)
       DO UPDATE SET source_targeting = $2,
                     disabled_sources = $3::jsonb,
                     updated_at = $4`,
      [
        accountId,
        JSON.stringify(sourceTargeting),
        JSON.stringify(disabledSources),
        now
      ]
    );

    if (input.terms) {
      // Replace user-edited terms wholesale; keep generated terms' rows.
      await client.query(
        `DELETE FROM search_terms WHERE account_id = $1 AND origin = 'user_edited'`,
        [accountId]
      );
      for (const t of input.terms) {
        const origin = t.origin === "generated" ? "generated" : "user_edited";
        if (origin === "user_edited") {
          await client.query(
            `INSERT INTO search_terms (account_id, term, origin, enabled, updated_at)
             VALUES ($1, $2, 'user_edited', $3, $4)`,
            [accountId, t.term, t.enabled !== false, now]
          );
        }
      }
    }

    if (input.enableGenerated) {
      for (const g of input.enableGenerated) {
        await client.query(
          `UPDATE search_terms SET enabled = $3, updated_at = $4
            WHERE account_id = $1 AND term = $2 AND origin = 'generated'`,
          [accountId, g.term, g.enabled, now]
        );
      }
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
