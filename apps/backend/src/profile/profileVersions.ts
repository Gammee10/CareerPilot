// Profile version snapshots (T3.4 / ADR-005). Every save creates a new
// immutable version; the current view resolves the latest approved version.
// Hard-constraint vs preference classification is validated at save time;
// strict toggles cannot be softened.
import type { Pool, PoolClient } from "pg";
import { recordAudit } from "../identity/audit.js";

export type SettingClassification = "hard_constraint" | "preference";

export type ProfileContent = {
  settings?: Record<string, { value: unknown; classification: SettingClassification; strict?: boolean }>;
  [key: string]: unknown;
};

const HARD_CONSTRAINT_KEYS = new Set([
  "remote_only",
  "employment_types",
  "excluded_companies",
  "locations",
  "salary_floor"
]);

export function validateProfileContent(raw: unknown):
  | { ok: true; content: ProfileContent }
  | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  const content = raw as ProfileContent;

  // Free-text sections are allowed; settings carry classification rules.
  const reserved = new Set(["settings", "skills", "summary"]);
  for (const key of Object.keys(content)) {
    if (!reserved.has(key) && typeof content[key] === "function") {
      return { ok: false, reason: `invalid_field:${key}` };
    }
  }

  if (content.settings === undefined) return { ok: true, content };

  if (typeof content.settings !== "object" || content.settings === null ||
      Array.isArray(content.settings)) {
    return { ok: false, reason: "invalid_settings" };
  }
  for (const [name, setting] of Object.entries(content.settings)) {
    if (
      typeof setting !== "object" ||
      setting === null ||
      !("value" in setting) ||
      !("classification" in setting)
    ) {
      return { ok: false, reason: `invalid_setting:${name}` };
    }
    if (setting.classification !== "hard_constraint" && setting.classification !== "preference") {
      return { ok: false, reason: `invalid_classification:${name}` };
    }
    // Strict toggles: hard-constraint switches must be strict so they can
    // never be treated as soft preferences downstream (FR-4/ADR-002).
    if (setting.classification === "hard_constraint" && setting.strict === false) {
      return { ok: false, reason: `strict_toggle_required:${name}` };
    }
    void HARD_CONSTRAINT_KEYS; // classification is user-declared per setting
  }

  if (content.skills !== undefined && !Array.isArray(content.skills)) {
    return { ok: false, reason: "invalid_skills" };
  }
  return { ok: true, content };
}

export type SaveResult =
  | { ok: true; profileVersionId: string; versionNumber: number }
  | { ok: false; reason: "invalid_content" };

export async function saveProfileVersion(
  db: Pool,
  accountId: string,
  rawContent: unknown,
  source: "manual" | "extraction_draft",
  now: Date
): Promise<SaveResult> {
  const validated = validateProfileContent(rawContent);
  if (!validated.ok) return { ok: false, reason: "invalid_content" };

  // H4: concurrent saves race MAX()+1 against the UNIQUE(account_id,
  // version_number) constraint. Serialize per account with an advisory lock
  // and retry once on a unique violation (e.g. lock bypass in tests).
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `profile-versions:${accountId}`
      ]);
      const maxRow = await client.query<{ max_version: number | null }>(
        "SELECT MAX(version_number) AS max_version FROM profile_versions WHERE account_id = $1",
        [accountId]
      );
      const nextVersion = (maxRow.rows[0].max_version ?? 0) + 1;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO profile_versions (account_id, version_number, source, content)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [accountId, nextVersion, source, JSON.stringify(validated.content)]
      );
      const versionId = inserted.rows[0].id;

      await client.query(
        `INSERT INTO career_profiles (account_id, current_profile_version_id, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id)
         DO UPDATE SET current_profile_version_id = $2, updated_at = $3`,
        [accountId, versionId, now]
      );
      await recordAudit(client, {
        actorType: "user",
        actorAccountId: accountId,
        action: "profile.saved",
        outcome: "success",
        targetCategory: "profile_version",
        targetId: versionId,
        details: { version_number: nextVersion, source }
      });
      await client.query("COMMIT");
      return { ok: true, profileVersionId: versionId, versionNumber: nextVersion };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Unique violation on (account_id, version_number): concurrent saver
      // won the number — retry with a fresh MAX().
      if (
        attempt < 2 &&
        typeof err === "object" && err !== null &&
        (err as { code?: string }).code === "23505"
      ) {
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error("profile_version_retry_exhausted");
}

// Current profile resolution: latest approved version (domain-model rule).
export async function getCurrentProfile(
  db: Pool | PoolClient,
  accountId: string
): Promise<{ id: string; version_number: number; content: unknown; saved_at: Date } | null> {
  const row = await db.query<{
    id: string;
    version_number: number;
    content: unknown;
    saved_at: Date;
  }>(
    `SELECT pv.id, pv.version_number, pv.content, pv.saved_at
       FROM career_profiles cp
       JOIN profile_versions pv ON pv.id = cp.current_profile_version_id
      WHERE cp.account_id = $1`,
    [accountId]
  );
  return row.rows[0] ?? null;
}
