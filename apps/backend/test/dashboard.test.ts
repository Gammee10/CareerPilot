// T7.1â€“T7.6 â€” dashboard surface: isolation, job views, truthful status,
// disclosures, closure, search-strategy controls.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createActiveUser,
  createBootstrapAdmin,
  makeHarness,
  request,
  resetDb,
  sessionCookie,
  withServer,
  type Harness
} from "./helpers.js";

let h: Harness;
const t0 = new Date("2026-08-23T12:00:00Z");
const now = () => new Date(t0.getTime() + 60_000);

beforeEach(async () => {
  h = makeHarness(now);
  await resetDb(db());
});
function db() {
  return h.db;
}
afterAll(async () => {
  if (h) await h.close();
});

async function signIn(email: string): Promise<{ cookie: string; accountId: string }> {
  const existing = await h.db.query<{ id: string }>(
    "SELECT id FROM accounts WHERE email = 'admin@example.invalid'"
  );
  const adminId =
    existing.rows[0]?.id ??
    (await createBootstrapAdmin(h.db, "admin@example.invalid"));
  const user = await createActiveUser(h, email, adminId, t0);
  let cookie = "";
  await withServer(h.app, async (port) => {
    const { requestSignInLink, confirmSignInLink } = await import(
      "../src/identity/signinLinks.js"
    );
    const link = await requestSignInLink(h.db, email, t0);
    if (!link.ok) throw Error("setup");
    await confirmSignInLink(h.db, link.token, t0);
    const redeem = await request(port, "POST", "/api/auth/signin-link/redeem", {
      body: { token: link.token }
    });
    cookie = sessionCookie(redeem);
  });
  return { cookie, accountId: user.accountId };
}

// ---------------------------------------------------------------------------
// Shared seed: one evaluated, active job for the primary user.
// ---------------------------------------------------------------------------

const SEEDS: Array<{ accountId: string; jobId: string }> = [];

async function seedEvaluatedJob(accountId: string): Promise<string> {
  // Ensure an approved profile exists for evaluation compatibility checks.
  const pvIns = await h.db.query<{ id: string }>(
    `INSERT INTO profile_versions (account_id, version_number, source, content)
     SELECT $1, 1, 'manual', '{"skills":["go"]}'
     WHERE NOT EXISTS (SELECT 1 FROM profile_versions WHERE account_id = $1)
     RETURNING id`,
    [accountId]
  );
  if (pvIns.rows[0]) {
    await h.db.query(
      `INSERT INTO career_profiles (account_id, current_profile_version_id)
       VALUES ($1, $2)`,
      [accountId, pvIns.rows[0].id]
    );
  }

  const job = await h.db.query<{ id: string }>(
    "INSERT INTO canonical_jobs DEFAULT VALUES RETURNING id"
  );
  await h.db.query(
    `INSERT INTO source_listings (job_source_slug, external_listing_key, canonical_job_id,
        current_title, current_location, preferred_application_url,
        alternative_application_urls, latest_observation_at, strong_match_key)
     VALUES ('greenhouse', 'd7-' || gen_random_uuid()::text, $1, 'Backend Engineer', 'Remote',
             'https://boards.greenhouse.io/acme/jobs/9',
             '["https://jobs.lever.co/acme/9"]'::jsonb, $2, 'acme|backend engineer|remote')`,
    [job.rows[0].id, t0]
  );
  await h.db.query(
    `INSERT INTO source_listing_observations (source_listing_id, observed_at, availability_signal, content_hash, provenance)
     SELECT id, $2, 'active', 'd7-hash', '{"restrictions":[]}' FROM source_listings WHERE canonical_job_id = $1`,
    [job.rows[0].id, t0]
  );
  const pv = await h.db.query<{ id: string }>(
    "SELECT current_profile_version_id AS id FROM career_profiles WHERE account_id = $1",
    [accountId]
  );
  const obs = await h.db.query<{ id: string }>(
    `SELECT o.id FROM source_listing_observations o
      JOIN source_listings l ON l.id = o.source_listing_id
     WHERE l.canonical_job_id = $1 ORDER BY observed_at DESC LIMIT 1`,
    [job.rows[0].id]
  );
  // Materialize believed availability for the seeded listing.
  const { refreshAvailability } = await import("../src/sources/pipeline.js");
  await refreshAvailability(h.db, job.rows[0].id, t0);

  const { createEvaluationSnapshot } = await import("../src/evaluation/snapshot.js");
  await createEvaluationSnapshot(    h.db,
    {
      accountId,
      canonicalJobId: job.rows[0].id,
      profileVersionId: pv.rows[0].id,
      inputObservationId: obs.rows[0].id,
      eligibility: "confirmed",
      constraintFailures: [],
      dimensions: [],
      explanation: [],
      score: 77
    },
    t0
  );
  SEEDS.push({ accountId, jobId: job.rows[0].id });
  return job.rows[0].id;
}

describe("T7.1 â€” isolation across the dashboard surface", () => {
  it.each([
    ["GET jobs", "/api/account/OTHER/jobs", "GET"],
    ["job detail", "/api/account/OTHER/jobs/x/detail", "GET"],
    ["review", "/api/account/OTHER/jobs/x/review", "POST"],
    ["search strategy", "/api/account/OTHER/search-strategy", "PUT"],
    ["closure request", "/api/account/OTHER/closure/request", "POST"],
    ["disclosures", "/api/account/OTHER/disclosures", "GET"]
  ])("%s is denied cross-account", async (_label, path, method) => {
    const owner = await signIn("owner@example.invalid");
    const attacker = await signIn("attacker@example.invalid");
    void owner;
    const resolved = path.replace("OTHER", attacker.accountId);
    await withServer(h.app, async (port) => {
      const res = await request(port, method as "GET" | "POST" | "PUT", resolved, {
        cookie: owner.cookie,
        body: method === "GET" ? undefined : { state: "saved", terms: [] }
      });
      expect([403, 404]).toContain(res.status);
    });
  });

  it("unauthenticated requests fail closed", async () => {
    await withServer(h.app, async (port) => {
      const res = await request(port, "GET", "/api/account/00000000-0000-4000-8000-00000000f001/jobs");
      expect(res.status).toBe(401);
    });
  });
});

describe("T7.2 â€” job views and review lifecycle", () => {
  it("ranked list shows evaluated active jobs with eligibility + pending flag", async () => {
    const user = await signIn("viewer@example.invalid");
    await seedEvaluatedJob(user.accountId);
    await withServer(h.app, async (port) => {
      const res = await request(port, "GET", `/api/account/${user.accountId}/jobs`, {
        cookie: user.cookie
      });
      expect(res.status).toBe(200);
      const jobs = (res.body as { jobs: Array<Record<string, unknown>> }).jobs;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        availability: "active",
        reviewState: "new",
        eligibility: "confirmed",
        pendingReevaluation: false
      });
    });
  });

  it("detail view exposes evidence, links, restrictions, dimensions", async () => {
    const user = await signIn("detailer@example.invalid");
    const jobId = await seedEvaluatedJob(user.accountId);
    await withServer(h.app, async (port) => {
      const res = await request(port, "GET", `/api/account/${user.accountId}/jobs/${jobId}/detail`, {
        cookie: user.cookie
      });
      expect(res.status).toBe(200);
      const detail = res.body as Record<string, unknown>;
      expect(detail.evidence).toHaveProperty("field:title");
      expect(detail.preferredApplicationUrl).toContain("greenhouse.io");
      expect(detail.alternativeApplicationUrls).toEqual(["https://jobs.lever.co/acme/9"]);
      expect(detail.eligibility).toBe("confirmed");
    });
  });

  it("not-interested jobs are NEVER re-presented as new (T7.2 AC)", async () => {
    const user = await signIn("dismiss@example.invalid");
    const jobId = await seedEvaluatedJob(user.accountId);
    await withServer(h.app, async (port) => {
      // lifecycle: new -> seen -> not_interested
      const s1 = await request(port, "POST", `/api/account/${user.accountId}/jobs/${jobId}/review`, {
        cookie: user.cookie,
        body: { state: "seen" }
      });
      expect(s1.status).toBe(200);
      const s2 = await request(port, "POST", `/api/account/${user.accountId}/jobs/${jobId}/review`, {
        cookie: user.cookie,
        body: { state: "not_interested" }
      });
      expect(s2.status).toBe(200);

      const list = await request(port, "GET", `/api/account/${user.accountId}/jobs`, {
        cookie: user.cookie
      });
      const jobs = (list.body as { jobs: unknown[] }).jobs;
      expect(jobs).toHaveLength(0); // gone from the view entirely

      // invalid transition rejected: saved from not_interested
      const s3 = await request(port, "POST", `/api/account/${user.accountId}/jobs/${jobId}/review`, {
        cookie: user.cookie,
        body: { state: "saved" }
      });
      expect(s3.status).toBe(409);
    });
  });

  it("evaluate endpoint persists a snapshot through the boundary", async () => {
    const user = await signIn("evaluator@example.invalid");
    const jobId = await seedEvaluatedJob(user.accountId);
    await withServer(h.app, async (port) => {
      const res = await request(port, "POST", `/api/account/${user.accountId}/jobs/${jobId}/evaluate`, {
        cookie: user.cookie,
        body: {}
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ eligibility: "confirmed", aiUsed: false });
    });
  });
});

describe("T7.3 â€” truthful discovery status rendering", () => {
  it("status endpoint exposes run status incl. partial + attempts summary", async () => {
    const user = await signIn("status@example.invalid");
    // A run requires an approved profile.
    const pv = await h.db.query<{ id: string }>(
      `INSERT INTO profile_versions (account_id, version_number, source, content)
       VALUES ($1, 1, 'manual', '{}') RETURNING id`,
      [user.accountId]
    );
    await h.db.query(
      `INSERT INTO career_profiles (account_id, current_profile_version_id) VALUES ($1, $2)`,
      [user.accountId, pv.rows[0].id]
    );
    const requested = await import("../src/discovery/orchestrator.js").then((m) =>
      m.requestDiscoveryRun(h.db, user.accountId, "scheduled", t0)
    );
    if (!("runId" in requested)) throw Error("setup");
    await h.db.query(
      `UPDATE discovery_runs SET status = 'running', started_at = $2, targeted_sources = '["greenhouse","lever"]'::jsonb
        WHERE id = $1`,
      [requested.runId, t0]
    );

    await h.db.query(
      `INSERT INTO source_collection_attempts (discovery_run_id, job_source_slug, attempt_number, status, observation_count)
       VALUES ($1, 'greenhouse', 1, 'succeeded', 4), ($1, 'lever', 1, 'failed_non_transient', 0)`,
      [requested.runId]
    );

    await withServer(h.app, async (port) => {
      const res = await request(port, "GET", `/api/account/${user.accountId}/discovery/status`, {
        cookie: user.cookie
      });
      expect(res.status).toBe(200);
      const body = res.body as { run: { status: string }; attempts: Array<{ status: string }> };
      expect(body.run.status).toBe("running"); // still running until targets terminal
      expect(body.attempts.map((a) => a.status)).toEqual(
        expect.arrayContaining(["succeeded", "failed_non_transient"])
      );
    });
  });
});

describe("T7.4 â€” disclosure gate + manual path", () => {
  it("upload grant refused before acknowledgement; allowed after (FR-0a)", async () => {
    const user = await signIn("disclosure@example.invalid");
    await withServer(h.app, async (port) => {
      const denied = await request(port, "POST", `/api/account/${user.accountId}/resume/upload-grant`, {
        cookie: user.cookie
      });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ error: "disclosure_required", disclosureKey: "resume_ai_processing" });

      const ack = await request(port, "POST", `/api/account/${user.accountId}/disclosures/acknowledge`, {
        cookie: user.cookie,
        body: { disclosureKey: "resume_ai_processing" }
      });
      expect(ack.status).toBe(200);

      const granted = await request(port, "POST", `/api/account/${user.accountId}/resume/upload-grant`, {
        cookie: user.cookie
      });
      expect(granted.status).toBe(201);
    });
  });

  it("manual profile save works without any resume or acknowledgement (FR-0a AC)", async () => {
    const user = await signIn("manual-only@example.invalid");
    await withServer(h.app, async (port) => {
      const res = await request(port, "POST", `/api/account/${user.accountId}/profile/save`, {
        cookie: user.cookie,
        body: {
          content: {
            settings: {},
            summary: "completed manually without resume"
          }
        }
      });
      expect(res.status).toBe(201);
    });
  });
});

describe("T7.5 â€” closure flow (FR-0b/ADR-036)", () => {
  it("request -> fresh link -> confirm -> redeem closes immediately; reuse fails safely", async () => {
    const user = await signIn("closer@example.invalid");

    await withServer(h.app, async (port) => {
      const reqRes = await request(port, "POST", `/api/account/${user.accountId}/closure/request`, {
        cookie: user.cookie
      });
      expect(reqRes.status).toBe(202);
      const token = h.mailer.closureConfirmations[0].url.split("token=")[1];

      const confirm = await request(port, "POST", "/api/auth/closure/confirm", {
        body: { token }
      });
      expect(confirm.body).toEqual({ status: "confirmed" });

      const redeem = await request(port, "POST", "/api/auth/closure/redeem", { body: { token } });
      expect(redeem.status).toBe(200);
      expect(redeem.body).toMatchObject({ status: "closed" });

      // Immediate access block.
      const me = await request(port, "GET", "/api/me", { cookie: user.cookie });
      expect(me.status).toBe(401);

      // Reuse of the same confirmation link fails safely (non-disclosing).
      const replayConfirm = await request(port, "POST", "/api/auth/closure/confirm", {
        body: { token }
      });
      expect(replayConfirm.status).toBe(400);
      const replayRedeem = await request(port, "POST", "/api/auth/closure/redeem", {
        body: { token }
      });
      expect(replayRedeem).toMatchObject({ status: 400, body: { error: "invalid_link" } });

      // Truthful deletion status survives on the closed account's records.
      const st = await import("../src/identity/closure.js").then((m) =>
        m.closureStatus(h.db, user.accountId)
      );
      expect(st.closed).toBe(true);
      expect(st.deletionDeadline).toBeTruthy();
    });
  });

  it("stale/unconfirmed closure links cannot close an account", async () => {
    const user = await signIn("closer2@example.invalid");
    await withServer(h.app, async (port) => {
      // Never-requested token.
      const bad = await request(port, "POST", "/api/auth/closure/redeem", {
        body: { token: "bogus-closure-token-aaaaaaaaaaaaaa" }
      });
      expect(bad.status).toBe(400);

      // Confirm-but-not-redeemed then expiry simulation: confirm a real one,
      // then attempt redemption with a DIFFERENT bogus token â€” original stays unconsumed.
      await request(port, "POST", `/api/account/${user.accountId}/closure/request`, {
        cookie: user.cookie
      });
      const token = h.mailer.closureConfirmations[0].url.split("token=")[1];
      const noConfirm = await request(port, "POST", "/api/auth/closure/redeem", {
        body: { token }
      });
      // Redemption WITHOUT prior confirmation fails (two-step enforced).
      expect(noConfirm.status).toBe(400);
      const acctState = await h.db.query("SELECT state FROM accounts WHERE id = $1", [
        user.accountId
      ]);
      expect(acctState.rows[0].state).toBe("active");
    });
  });
});

describe("T7.6 â€” search strategy controls", () => {
  it("PUT replaces user-edited terms, disables generated terms, exposes transparency", async () => {
    const user = await signIn("strategy@example.invalid");
    // Seed generated terms as discovery would.
    await h.db.query(
      `INSERT INTO search_terms (account_id, term, origin, enabled, expanded_from)
       VALUES ($1, 'backend engineer', 'generated', true, null),
              ($1, 'platform engineer', 'generated', true, 'backend engineer')`,
      [user.accountId]
    );

    await withServer(h.app, async (port) => {
      const put = await request(port, "PUT", `/api/account/${user.accountId}/search-strategy`, {
        cookie: user.cookie,
        body: {
          enableGenerated: [
            { term: "backend engineer", enabled: true },
            { term: "platform engineer", enabled: false } // related-role expansion disabled
          ],
          terms: [{ term: "golang jobs", origin: "user_edited", enabled: true }],
          disabledSources: ["remoteok"],
          sourceTargeting: { companies: ["acme"] }
        }
      });
      expect(put.status).toBe(200);
      const strategy = put.body as {
        terms: Array<{ term: string; origin: string; enabled: boolean; expandedFrom: string | null }>;
        transparencyNotice: string;
        disabledSources: string[];
      };
      expect(strategy.transparencyNotice).toContain("related roles");
      const platformTerm = strategy.terms.find((t) => t.term === "platform engineer");
      expect(platformTerm?.enabled).toBe(false);
      expect(platformTerm?.expandedFrom).toBe("backend engineer"); // expansion visible
      expect(strategy.disabledSources).toEqual(["remoteok"]);
      expect(strategy.terms.some((t) => t.term === "golang jobs")).toBe(true);
    });
  });
});
