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

export async function updateSearchStrategy(
  db: Pool,
  accountId: string,
  input: UpdateStrategyInput,
  now: Date
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO search_strategy (account_id, source_targeting, disabled_sources, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (account_id)
       DO UPDATE SET source_targeting = $2,
                     disabled_sources = $3::jsonb,
                     updated_at = $4`,
      [
        accountId,
        JSON.stringify(input.sourceTargeting ?? {}),
        JSON.stringify(input.disabledSources ?? []),
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
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
