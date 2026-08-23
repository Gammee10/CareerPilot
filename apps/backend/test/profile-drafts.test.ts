// T3.3 — Draft review workflow + T3.4 profile versions (FR-1–FR-5, ADR-005).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { InMemoryObjectStore } from "../src/storage/objectStore.js";
import { runExtraction } from "../src/profile/extraction.js";
import { saveProfileVersion, getCurrentProfile } from "../src/profile/profileVersions.js";
import {
  createActiveUser,
  createBootstrapAdmin,
  makeHarness,
  RecordingAiClient,
  resetDb,
  type Harness
} from "./helpers.js";

let h: Harness;
let store: InMemoryObjectStore;
const t0 = new Date("2026-08-23T12:00:00Z");

const PROPOSAL = {
  summary: "Backend engineer",
  skills: ["Go"],
  employment: [{ title: "Engineer", company: "Acme", startDate: "2020", endDate: null }],
  education: [{ degree: "BSc", institution: "State U", year: 2015 }],
  certifications: ["CKA"]
};

beforeEach(async () => {
  store = new InMemoryObjectStore();
  h = makeHarness(() => new Date(t0.getTime() + 60_000), { store });
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

async function setupWithDraft(): Promise<{ accountId: string; draftId: string }> {
  const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const user = await createActiveUser(h, "reviewer@example.invalid", adminId, t0);
  const { createUploadGrant, completeUpload } = await import("../src/profile/resumes.js");
  const grant = await createUploadGrant(h.db, user.accountId, t0);
  const uploaded = await completeUpload(
    h.db, store, grant.token, Buffer.from("resume text"), "text/plain", t0
  );
  if (!uploaded.ok) throw Error("setup");
  const ai = new RecordingAiClient(() => PROPOSAL);
  const result = await runExtraction(h.db, store, ai, uploaded.resumeDocumentId, t0);
  if (!result.ok) throw Error("setup extraction");
  return { accountId: user.accountId, draftId: result.draftId };
}

describe("draft workflow (T3.3)", () => {
  it("edits update the draft only and never create profile versions", async () => {
    const { accountId, draftId } = await setupWithDraft();

    const edited = { ...PROPOSAL, summary: "Senior backend engineer" };
    const { editDraft } = await import("../src/profile/drafts.js");
    const result = await editDraft(h.db, accountId, draftId, edited, t0);
    expect(result).toEqual({ ok: true });

    // No version exists yet — the draft is not authoritative until saved.
    const versions = await h.db.query(
      "SELECT id FROM profile_versions WHERE account_id = $1",
      [accountId]
    );
    expect(versions.rows).toHaveLength(0);

    const current = await getCurrentProfile(h.db, accountId);
    expect(current).toBeNull(); // discovery would have no approved profile
  });

  it("accepting the draft creates an immutable version linked to the draft", async () => {
    const { accountId, draftId } = await setupWithDraft();
    const { acceptDraft } = await import("../src/profile/drafts.js");

    const result = await acceptDraft(h.db, accountId, draftId, t0);
    expect(result).toMatchObject({ ok: true, versionNumber: 1 });

    const current = await getCurrentProfile(h.db, accountId);
    expect(current?.version_number).toBe(1);
    expect((current?.content as { summary?: string }).summary).toBe("Backend engineer");

    // Draft is consumed.
    const row = await h.db.query<{ status: string; accepted_profile_version_id: string }>(
      "SELECT status, accepted_profile_version_id FROM resume_extraction_drafts WHERE id = $1",
      [draftId]
    );
    expect(row.rows[0].status).toBe("accepted");
    expect(row.rows[0].accepted_profile_version_id).toBeTruthy();
  });

  it("an accepted draft can no longer be edited or re-accepted", async () => {
    const { accountId, draftId } = await setupWithDraft();
    const drafts = await import("../src/profile/drafts.js");
    await drafts.acceptDraft(h.db, accountId, draftId, t0);

    const editAgain = await drafts.editDraft(h.db, accountId, draftId, PROPOSAL, t0);
    expect(editAgain).toEqual({ ok: false, reason: "not_editable" });
    const acceptAgain = await drafts.acceptDraft(h.db, accountId, draftId, t0);
    expect(acceptAgain).toEqual({ ok: false, reason: "not_editable" });
  });

  it("discarding a draft leaves no trace in the profile lineage", async () => {
    const { accountId, draftId } = await setupWithDraft();
    const { discardDraft } = await import("../src/profile/drafts.js");
    expect(await discardDraft(h.db, accountId, draftId, t0)).toBe(true);
    const versions = await h.db.query(
      "SELECT id FROM profile_versions WHERE account_id = $1",
      [accountId]
    );
    expect(versions.rows).toHaveLength(0);
  });

  it("manual completion path works without any resume or draft (FR-0a)", async () => {
    const adminId = await createBootstrapAdmin(h.db, "admin2@example.invalid");
    const user = await createActiveUser(h, "manual@example.invalid", adminId, t0);
    const result = await saveProfileVersion(
      h.db,
      user.accountId,
      {
        settings: {
          remote_only: { value: true, classification: "hard_constraint", strict: true },
          salary_floor: { value: 90000, classification: "preference" }
        },
        skills: ["Rust"],
        summary: "Manual entry"
      },
      "manual",
      t0
    );
    expect(result.ok).toBe(true);
    const current = await getCurrentProfile(h.db, user.accountId);
    expect(current?.version_number).toBe(1);
  });
});

describe("profile versions (T3.4 / ADR-005)", () => {
  it("each save creates a numbered immutable snapshot; current resolves latest", async () => {
    const adminId = await createBootstrapAdmin(h.db, "admin3@example.invalid");
    const user = await createActiveUser(h, "versions@example.invalid", adminId, t0);

    const v1 = await saveProfileVersion(h.db, user.accountId, { summary: "one" }, "manual", t0);
    const v2 = await saveProfileVersion(h.db, user.accountId, { summary: "two" }, "manual", t0);
    if (!v1.ok || !v2.ok) throw Error("setup");
    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);

    const current = await getCurrentProfile(h.db, user.accountId);
    expect(current?.id).toBe(v2.profileVersionId);

    const history = await h.db.query(
      "SELECT version_number, content FROM profile_versions WHERE account_id = $1 ORDER BY version_number",
      [user.accountId]
    );
    expect(history.rows.map((r) => r.content)).toEqual([
      { summary: "one" },
      { summary: "two" }
    ]);
  });

  it("rejects invalid classifications and softened strict toggles", async () => {
    const adminId = await createBootstrapAdmin(h.db, "admin4@example.invalid");
    const user = await createActiveUser(h, "toggles@example.invalid", adminId, t0);

    const badClassification = await saveProfileVersion(
      h.db, user.accountId,
      { settings: { x: { value: 1, classification: "sort_of_important" } } },
      "manual", t0
    );
    expect(badClassification).toEqual({ ok: false, reason: "invalid_content" });

    const softenedStrict = await saveProfileVersion(
      h.db, user.accountId,
      { settings: { remote_only: { value: true, classification: "hard_constraint", strict: false } } },
      "manual", t0
    );
    expect(softenedStrict).toEqual({ ok: false, reason: "invalid_content" });

    const validStrict = await saveProfileVersion(
      h.db, user.accountId,
      { settings: { remote_only: { value: true, classification: "hard_constraint", strict: true } } },
      "manual", t0
    );
    expect(validStrict.ok).toBe(true);
  });
});
