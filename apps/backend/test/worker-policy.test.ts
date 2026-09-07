// M9 — worker lifecycle primitives: complete enqueue policy + correlation
// wiring. No broker needed: these assert the static policy contract and the
// AsyncLocalStorage primitive the handlers run inside.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ENQUEUE_POLICY, QUEUES } from "../src/work/boss.js";
import { withCorrelation, logEvent } from "../src/observability/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker policy (M9)", () => {
  it("every registered queue has a bounded transient-only retry policy", () => {
    for (const q of QUEUES) {
      const policy = ENQUEUE_POLICY[q];
      expect(policy, `queue ${q}`).toBeDefined();
      // Bounded per ADR-044: small retry budget, never unbounded.
      expect(policy.retryLimit).toBeGreaterThanOrEqual(0);
      expect(policy.retryLimit).toBeLessThanOrEqual(3);
      expect(policy.retryDelay).toBeGreaterThan(0);
    }
  });

  it("job-handler correlation scopes emit correlation IDs in logs", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      lines.push(String(msg));
    });
    const seen = await withCorrelation(async (id) => {
      logEvent("info", "test_job_handled", { queue: "collection" });
      return id;
    });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const ours = parsed.find((l) => l.event === "test_job_handled");
    expect(ours?.correlationId).toBe(seen);
    expect(typeof ours?.correlationId).toBe("string");
  });
});
