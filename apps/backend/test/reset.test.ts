// L8: resetDb must cover every mutable table or tests leak state into each
// other (order dependence). This test fails on drift: any table added by a
// migration without a RESET_TABLES entry is reported here.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestPool, RESET_TABLES } from "./helpers.js";

// Tables resetDb must never touch: seeded reference data + bookkeeping.
const PINNED = new Set(["job_sources", "schema_migrations"]);

describe("resetDb coverage (L8)", () => {
  let db: ReturnType<typeof makeTestPool>;
  beforeAll(() => {
    db = makeTestPool();
  });
  afterAll(async () => {
    await db.end();
  });

  it("covers every public base table except pinned seeds/bookkeeping", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const actual = rows.map((r) => r.table_name).sort();
    expect(actual.length).toBeGreaterThan(20);
    const missing = actual.filter((t) => !PINNED.has(t) && !RESET_TABLES.includes(t));
    expect(missing).toEqual([]);
    const unknown = RESET_TABLES.filter((t) => !actual.includes(t));
    expect(unknown).toEqual([]);
    for (const p of PINNED) expect(RESET_TABLES).not.toContain(p);
  });
});
