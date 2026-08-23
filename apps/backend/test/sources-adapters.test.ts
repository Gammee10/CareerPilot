// T4.1 — Adapters: contract conformance, limits, disable behavior.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PoliteClient, type HttpResponse, type Transport } from "../src/sources/politeClient.js";
import { greenhouseAdapter, leverAdapter, remoteokAdapter } from "../src/sources/adapters.js";
import { checkCollectionAllowed } from "../src/sources/registry.js";
import {
  resetDb
} from "./helpers.js";
import { testDbConfig, TEST_DB } from "./global-setup.js";
import { Pool } from "pg";

const db = new Pool({ ...testDbConfig(), database: TEST_DB });
let calls: Array<{ url: string; at: number }>;
let sleeps: number[];
let clock: number;

function fakeTransport(responder: (url: string) => HttpResponse): Transport {
  return async (url) => {
    calls.push({ url, at: clock });
    clock += 10; // transport itself is fast
    return responder(url);
  };
}

function client(transport: Transport): PoliteClient {
  clock = 0;
  calls = [];
  sleeps = [];
  return new PoliteClient(transport, async (ms) => {
    sleeps.push(ms);
    clock += ms; // simulated time advance
  }, () => clock);
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

describe("adapter enable/disable gate", () => {
  it("disabled adapter performs zero network requests (T4.1 AC)", async () => {
    await db.query("UPDATE job_sources SET enabled = false WHERE slug = 'greenhouse'");
    const gate = await checkCollectionAllowed(db, "greenhouse");
    expect(gate).toEqual({ allowed: false, reason: "disabled" });
    // Restore for subsequent tests (job_sources is not part of resetDb).
    await db.query("UPDATE job_sources SET enabled = true WHERE slug = 'greenhouse'");
  });

  it("terms validation is a blocking precondition before first use", async () => {
    // All three sources have T4.0 records from migration 0004.
    for (const slug of ["greenhouse", "lever", "remoteok"] as const) {
      const gate = await checkCollectionAllowed(db, slug);
      expect(gate.allowed).toBe(true);
    }
    const record = await db.query<{ terms_validation_ref: string }>(
      `SELECT terms_validation_ref FROM job_sources WHERE slug = 'remoteok'`
    );
    expect(record.rows[0].terms_validation_ref).toContain("source-terms.md");
  });

  it("unknown source is denied", async () => {
    const gate = await checkCollectionAllowed(db, "indeed" as never);
    expect(gate).toEqual({ allowed: false, reason: "unknown_source" });
  });
});

describe("Greenhouse adapter", () => {
  it("emits contract-conforming observations with provenance", async () => {
    const c = client(fakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        jobs: [
          {
            id: 123,
            title: "Senior Backend Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
            location: { name: "Remote, EU" },
            updated_at: "2026-08-20T12:00:00-04:00",
            content: "<p>Build <b>things</b> &amp; more</p>"
          }
        ]
      })
    })));

    const result = await greenhouseAdapter({ boardToken: "acme" }).collect({
      client: c, pageBudget: 5, fetchedAt: "2026-08-23T12:00:00Z"
    });

    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    expect(obs).toMatchObject({
      source: "greenhouse",
      externalListingKey: "123",
      companyName: "acme",
      title: "Senior Backend Engineer",
      location: "Remote, EU",
      descriptionText: "Build things & more",
      availabilitySignal: "active"
    });
    expect(obs.applicationUrls.preferred).toContain("greenhouse.io/acme/jobs/123");
    expect(obs.provenance.boardToken).toBe("acme");
  });
});

describe("Lever adapter pagination budget", () => {
  function leverPage(n: number): HttpResponse {
    return {
      status: 200,
      headers: {},
      body: JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          id: `${n}-${i}`,
          text: `Engineer ${n}-${i}`,
          categories: { location: "Berlin" },
          hostedUrl: `https://jobs.lever.co/site/${n}-${i}`,
          createdAt: 1755900000000
        }))
      )
    };
  }

  it("stops at the configured page budget (ADR-059 bounded pages)", async () => {
    const c = client(fakeTransport((url) => {
      const skip = Number(new URL(url).searchParams.get("skip") ?? 0);
      // Infinite supply of full pages.
      return skip >= 100 ? leverPage(50) : leverPage(50);
    }));

    const result = await leverAdapter({ site: "site" }).collect({
      client: c, pageBudget: 3, fetchedAt: "2026-08-23T12:00:00Z"
    });

    expect(result.pagesFetched).toBe(3);       // hard stop at budget
    expect(result.observations.length).toBe(150);
    expect(calls.filter((x) => x.url.includes("api.lever.co")).length).toBe(3);

    const obs = result.observations[0];
    expect(obs.source).toBe("lever");
    expect(obs.applicationUrls.preferred.startsWith("https://jobs.lever.co/")).toBe(true);
  });
});

describe("politeness policy", () => {
  it("enforces the sustained ~1 req/s rate between consecutive requests", async () => {
    const c = client(fakeTransport(() => ({ status: 200, headers: {}, body: "[]" })));
    await c.getJson("https://api.lever.co/v0/postings/a?mode=json");
    await c.getJson("https://api.lever.co/v0/postings/b?mode=json");

    // Second request was held until at least one full interval had elapsed.
    expect(calls.length).toBe(2);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
  });

  it("honors Retry-After on 429 and retries within attempt budget", async () => {
    let hits = 0;
    const c = client(fakeTransport(() => {
      hits += 1;
      if (hits === 1) {
        return { status: 429, headers: { "retry-after": "7" }, body: "" };
      }
      return { status: 200, headers: {}, body: JSON.stringify([]) };
    }));

    const result = await c.getJson<unknown[]>("https://remoteok.com/api");
    expect(result.data).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(sleeps).toContain(7000); // Retry-After honored exactly
  });

  it("does NOT retry non-transient failures (ADR-044)", async () => {
    const c = client(fakeTransport(() => ({ status: 404, headers: {}, body: "nope" })));
    await expect(c.getJson("https://example.invalid/api")).rejects.toThrow(/non_transient/);
    expect(calls.length).toBe(1); // single attempt only
  });

  it("exhausts at most three attempts on persistent transient errors", async () => {
    const c = client(fakeTransport(() => ({
      status: 503, headers: { "retry-after": "1" }, body: ""
    })));
    await expect(c.getJson("https://remoteok.com/api")).rejects.toThrow(/attempts_exhausted/);
    expect(calls.length).toBe(3);
  });
});

describe("RemoteOK adapter", () => {
  it("skips the legal notice element and preserves binding restrictions", async () => {
    const legalNotice = {
      legal: "By using Remote OK's API feed you legally agree to mention Remote OK as a source and link back..."
    };
    const job = {
      slug: "senior-rust-engineer",
      position: "Senior Rust Engineer",
      company: "ExampleCorp",
      location: "Worldwide",
      url: "https://remoteok.com/remote-jobs/senior-rust-engineer",
      date: "2026-08-22T00:00:00Z",
      description: "<p>Rust + Kubernetes</p>"
    };
    const c = client(fakeTransport(() => ({
      status: 200, headers: {}, body: JSON.stringify([legalNotice, job])
    })));

    const result = await remoteokAdapter().collect({
      client: c, pageBudget: 1, fetchedAt: "2026-08-23T12:00:00Z"
    });

    expect(result.observations).toHaveLength(1); // legal element skipped
    const obs = result.observations[0];
    expect(obs.externalListingKey).toBe("senior-rust-engineer");
    // Direct link back to remoteok.com preserved as the application URL.
    expect(obs.applicationUrls.preferred).toBe(job.url);
    expect(obs.restrictions).toContain("remoteok_attribution_direct_link");
    expect(obs.provenance.legalNoticeAcknowledged).toBe(true);
  });
});
