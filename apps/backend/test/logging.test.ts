// T8.1 AC — log-scan over a full simulated user journey: no resume, profile,
// job text, or AI content may appear in any log line; lines are structured
// JSON and carry correlation ids inside a correlation scope.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { withCorrelation, logEvent } from "../src/observability/logger.js";
import { createBootstrapAdmin, makeHarness, RecordingAiClient, resetDb } from "./helpers.js";
import { InMemoryObjectStore } from "../src/storage/objectStore.js";

const t0 = new Date("2026-08-23T12:00:00Z");

// Distinctive strings that must NEVER appear in logs.
const RESUME_TEXT = [
  "RESUME-CANARY-9f3b1c",
  "jane.classified.canary@example.com",
  "+1-202-555-0147",
  "https://private-canary.example.org/cv"
].join("\n");

let h: ReturnType<typeof makeHarness>;
let logLines: string[];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  h = makeHarness(() => new Date(t0.getTime() + 60_000), { store: new InMemoryObjectStore() });
  await resetDb(h.db);
  logLines = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  logSpy.mockRestore();
});
afterAll(async () => {
  await h.close();
});

describe("T8.1 — structured logging minimization", () => {
  it("full user journey emits only minimized structured JSON (no sensitive content)", async () => {
    const adminId = await createBootstrapAdmin(h.db, "admin@example.invalid");
    const store = new InMemoryObjectStore();
    const ai = new RecordingAiClient(() => ({
      skills: ["go"],
      employment: [],
      education: [],
      certifications: []
    }));

    await withCorrelation(async (correlationId) => {
      // Journey: activate -> upload distinctive resume -> extract -> save
      // profile -> discovery -> closure request.
      const { issueInvitation, acceptInvitation } = await import(
        "../src/identity/invitations.js"
      );
      const inv = await issueInvitation(h.db, "journey@example.invalid", adminId, t0);
      if (!inv.ok) throw Error("setup");
      const acct = await acceptInvitation(h.db, inv.token, t0);
      if (!acct.ok) throw Error("setup");

      const { requestSignInLink } = await import("../src/identity/signinLinks.js");
      const link = await requestSignInLink(h.db, "journey@example.invalid", t0);
      if (!link.ok) throw Error("setup");
      void link;

      const { createUploadGrant, completeUpload } = await import("../src/profile/resumes.js");
      const grant = await createUploadGrant(h.db, acct.accountId, t0);
      const uploaded = await completeUpload(
        h.db, store, grant.token, Buffer.from(RESUME_TEXT), "text/plain", t0
      );
      if (!uploaded.ok) throw Error("setup upload");

      await import("../src/profile/extraction.js").then((m) =>
        m.runExtraction(h.db, store, ai, uploaded.resumeDocumentId, t0)
      );

      await import("../src/profile/profileVersions.js").then((m) =>
        m.saveProfileVersion(
          h.db,
          acct.accountId,
          { settings: {}, summary: "PROFILE-SUMMARY-CANARY" },
          "manual",
          t0
        )
      );

      await import("../src/discovery/orchestrator.js").then((m) =>
        m.requestDiscoveryRun(h.db, acct.accountId, "manual", t0)
      );

      await import("../src/identity/closure.js").then((m) =>
        m.requestClosureConfirmation(h.db, acct.accountId, t0)
      );

      logEvent("info", "journey.completed", { steps: 8 });
      void correlationId;
    });

    // All captured lines parse as JSON.
    for (const line of logLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // No sensitive canaries anywhere in the logs.
    const all = logLines.join("\n");
    expect(all).not.toContain("RESUME-CANARY-9f3b1c");
    expect(all).not.toContain("jane.classified.canary@example.com");
    expect(all).not.toContain("+1-202-555-0147");
    expect(all).not.toContain("private-canary.example.org");
    expect(all).not.toContain("PROFILE-SUMMARY-CANARY");

    // Correlation id present on events emitted inside the scope.
    const parsed = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const correlatedEvents = parsed.filter((p) => p.event === "journey.completed");
    expect(correlatedEvents).toHaveLength(1);
    expect(typeof correlatedEvents[0].correlationId).toBe("string");
  });
});
