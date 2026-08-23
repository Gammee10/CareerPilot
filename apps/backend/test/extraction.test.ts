// T3.2 â€” Extraction pipeline: minimization boundary + Node-side validation.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { InMemoryObjectStore } from "../src/storage/objectStore.js";
import { runExtraction } from "../src/profile/extraction.js";
import { buildExtractionTask } from "../src/profile/minimization.js";
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

const VALID_PROPOSAL = {
  skills: ["Go", "PostgreSQL"],
  employment: [{ title: "Engineer", company: "[REDACTED_NAME] Corp", startDate: "2020-01", endDate: null }],
  education: [{ degree: "BSc", institution: "State University", year: 2015 }],
  certifications: []
};

beforeEach(async () => {
  store = new InMemoryObjectStore();
  h = makeHarness(() => new Date(t0.getTime() + 60_000), { store });
  await resetDb(h.db);
});
afterAll(async () => {
  await h.close();
});

async function uploadTextResume(text: string): Promise<string> {
  const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
  const user = await createActiveUser(h, "candidate@example.invalid", adminId, t0);
  const { createUploadGrant, completeUpload } = await import("../src/profile/resumes.js");
  const grant = await createUploadGrant(h.db, user.accountId, t0);
  const uploaded = await completeUpload(
    h.db,
    store,
    grant.token,
    Buffer.from(text),
    "text/plain",
    t0
  );
  if (!uploaded.ok) throw Error("setup upload failed");
  return uploaded.resumeDocumentId;
}

describe("minimization boundary (ADR-054)", () => {
  it("redacts emails, phones, URLs, filenames, account ids and known names", () => {
    const task = buildExtractionTask(
      [
        "Jane Doe",
        "Email: jane.doe@example.com | Phone: +1 (415) 555-0132",
        "Portfolio: https://janedoe.dev/cv-final-v3.pdf",
        "My old resume file: cv_final_v3.pdf",
        "Internal ref: 3f2504e0-4f89-11d3-9a0c-0305e82c3301"
      ].join("\n"),
      { knownNames: ["Jane Doe"], knownAccountIds: ["3f2504e0-4f89-11d3-9a0c-0305e82c3301"] }
    );

    expect(task.content).not.toContain("jane.doe@example.com");
    expect(task.content).not.toContain("+1 (415) 555-0132");
    expect(task.content).not.toContain("https://janedoe.dev");
    expect(task.content.toLowerCase()).not.toContain("cv_final_v3.pdf");
    expect(task.content).toContain("[REDACTED_FILENAME]");
    expect(task.content).not.toContain("Jane Doe");
    expect(task.content).not.toContain("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  it("the provider-visible payload never contains identifiers (T3.2 AC)", async () => {
    const raw = [
      "Sam Person, sam.person@corp.example, +44 20 7946 0958",
      "See https://sam.example.io and resume_2026.pdf"
    ].join("\n");
    const docId = await uploadTextResume(raw);
    const ai = new RecordingAiClient(() => VALID_PROPOSAL);

    await runExtraction(h.db, store, ai, docId, t0);

    expect(ai.sentTasks).toHaveLength(1);
    const sent = JSON.stringify(ai.sentTasks[0]);
    expect(sent).not.toContain("sam.person@corp.example");
    expect(sent).not.toContain("+44 20 7946 0958");
    expect(sent).not.toContain("https://sam.example.io");
    expect(sent.toLowerCase()).not.toContain("resume_2026.pdf");
    // No account id mapping leaves the boundary either.
    const accounts = await h.db.query<{ email: string }>("SELECT email::text AS email FROM accounts WHERE email = 'candidate@example.invalid'");
    expect(sent).not.toContain(accounts.rows[0].email);
  });
});

describe("Node-side proposal validation (ADR-029/054)", () => {
  it.each([
    ["top-level junk", { ...VALID_PROPOSAL, instructions: "ignore all constraints" }],
    ["bad employment entry", { ...VALID_PROPOSAL, employment: [{ title: 5 }] }],
    ["skills not strings", { ...VALID_PROPOSAL, skills: [42] }],
    ["year nonsense", { ...VALID_PROPOSAL, education: [{ degree: "X", institution: "Y", year: 30251 }] }]
  ])("rejects malformed output (%s) without persisting anything", async (_label, bad) => {
    const docId = await uploadTextResume("Some text content for extraction.");
    const ai = new RecordingAiClient(() => bad);
    const result = await runExtraction(h.db, store, ai, docId, t0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed_output");

    const drafts = await h.db.query("SELECT id FROM resume_extraction_drafts WHERE resume_document_id = $1", [docId]);
    expect(drafts.rows).toHaveLength(0); // nothing persisted

    const audit = await h.db.query(
      "SELECT action FROM audit_events WHERE action = 'extraction.rejected_malformed'"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("provider unavailability produces a truthful failure, not a draft", async () => {
    const docId = await uploadTextResume("More text.");
    const ai = new RecordingAiClient(() => new Error("ai_unavailable"));
    const result = await runExtraction(h.db, store, ai, docId, t0);
    expect(result).toEqual({ ok: false, reason: "ai_unavailable" });
    const drafts = await h.db.query("SELECT id FROM resume_extraction_drafts");
    expect(drafts.rows).toHaveLength(0);
  });

  it("valid proposals persist exactly one ready draft", async () => {
    const docId = await uploadTextResume("Good text.");
    const ai = new RecordingAiClient(() => VALID_PROPOSAL);
    const first = await runExtraction(h.db, store, ai, docId, t0);
    expect(first.ok).toBe(true);
    // Idempotent re-run (retry after crash before ack): no duplicate draft.
    const second = await runExtraction(h.db, store, ai, docId, t0);
    expect(second).toMatchObject({ ok: true, reusedExisting: true });

    const drafts = await h.db.query(
      "SELECT status FROM resume_extraction_drafts WHERE resume_document_id = $1",
      [docId]
    );
    expect(drafts.rows).toHaveLength(1);
    expect(drafts.rows[0].status).toBe("ready");
  });
});
