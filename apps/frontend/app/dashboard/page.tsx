"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/urls";

type Me = { accountId: string; isAdmin: boolean };
type JobItem = {
  canonicalJobId: string;
  title: string | null;
  company: string | null;
  location: string | null;
  availability: string;
  reviewState: string;
  eligibility: string | null;
  score: number | null;
  pendingReevaluation: boolean;
};
type JobDetail = {
  evidence: Record<string, { field: string; value: string }>;
  explanation: Array<{ statement: string; kind: string; confidence: string; evidenceRefs: string[] }>;
  constraintFailures: Array<{ constraint: string; detail: string }>;
  preferredApplicationUrl: string | null;
  alternativeApplicationUrls: string[];
  restrictions: string[];
  eligibility: string | null;
  dimensions: Array<{ name: string; weight: number; score: number; penalties: Array<{ reason: string }> }>;
  reviewState: string;
};
type DiscoveryStatus = {
  run: { status: string; completed_at: string | null } | null;
  attempts: Array<{ job_source_slug: string; status: string }>;
};
type Strategy = {
  terms: Array<{ term: string; origin: string; enabled: boolean; expandedFrom: string | null }>;
  transparencyNotice: string;
};

// M13: hoisted to module scope. Components defined inside the parent
// re-mount on every parent render (new component identity), wiping their
// useState (e.g. expanded job details collapse on any refresh).
function DetailRow({
  jobId,
  cached,
  loadDetail
}: {
  jobId: string;
  cached: JobDetail | undefined;
  loadDetail: (jobId: string) => Promise<JobDetail>;
}) {
  const [d, setD] = useState<JobDetail | null>(cached ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Cached values are picked up by the initializer on mount; the effect
    // only fetches, and only from async callbacks (no sync setState).
    if (cached) return;
    let cancelled = false;
    loadDetail(jobId)
      .then((v) => {
        if (!cancelled) setD(v);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, cached, loadDetail]);
  if (failed) return <p role="alert">Job detail could not be loaded.</p>;
  if (!d) return <p>Loading detail…</p>;
  return (
    <div style={{ background: "#f6f6f6", padding: "0.75rem", marginTop: "0.5rem" }}>
      <p>
        Eligibility: <strong>{d.eligibility ?? "pending evaluation"}</strong>
        {d.constraintFailures.map((f) => (
          <span key={f.constraint}> · excluded: {f.detail}</span>
        ))}
      </p>
      <ul>
        {d.explanation?.map?.((c: { statement: string; kind: string; confidence: string; evidenceRefs: string[] }, i: number) => (
          <li key={i}>
            [{c.kind}/{c.confidence}] {c.statement}
            {c.evidenceRefs.length > 0 && (
              <small> ({c.evidenceRefs.map((ref) => `${ref}="${d.evidence[ref]?.value ?? ""}"`).join(", ")})</small>
            )}
          </li>
        ))}
      </ul>
      <p>
        Apply:{" "}
        {isSafeHttpUrl(d.preferredApplicationUrl) ? (
          <a href={d.preferredApplicationUrl as string} target="_blank" rel="noopener noreferrer">
            primary application link
          </a>
        ) : (
          <span>primary application link unavailable (unsafe URL)</span>
        )}
        {d.alternativeApplicationUrls.map((u) =>
          isSafeHttpUrl(u) ? (
            <span key={u}>
              {" · "}
              <a href={u} target="_blank" rel="noopener noreferrer">
                alternative
              </a>
            </span>
          ) : null
        )}
        {d.restrictions.length > 0 && <small> · source obligations: {d.restrictions.join(", ")}</small>}
      </p>
    </div>
  );
}

function Job({
  item,
  reviewPending,
  onReview,
  cachedDetail,
  loadDetail
}: {
  item: JobItem;
  reviewPending: boolean;
  onReview: (jobId: string, state: string) => void;
  cachedDetail: JobDetail | undefined;
  loadDetail: (jobId: string) => Promise<JobDetail>;
}) {
  const [open, setOpen] = useState(false);
  const detailId = `job-detail-${item.canonicalJobId}`;
  return (
    <li style={{ marginBottom: "1rem", listStyle: "none", borderBottom: "1px solid #ddd", paddingBottom: "0.75rem" }}>
      <strong>{item.title ?? "(untitled)"}</strong> — {item.company} · {item.location}
      <br />
      <small>
        score {item.score ?? "—"} · eligibility {item.eligibility ?? "pending"} · availability{" "}
        {item.availability} · {item.reviewState}
        {item.pendingReevaluation && " · re-evaluation pending"}
      </small>
      <br />
      <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
        {open ? "Hide details" : "Why this job?"}
      </button>{" "}
      {item.reviewState === "new" && (
        <button type="button" disabled={reviewPending} onClick={() => onReview(item.canonicalJobId, "seen")}>Mark seen</button>
      )}
      {item.reviewState === "seen" && (
        <>
          <button type="button" disabled={reviewPending} onClick={() => onReview(item.canonicalJobId, "saved")}>Save</button>
          <button type="button" disabled={reviewPending} onClick={() => onReview(item.canonicalJobId, "not_interested")}>Not interested</button>
        </>
      )}
      {open && (
        <div id={detailId}>
          <DetailRow jobId={item.canonicalJobId} cached={cachedDetail} loadDetail={loadDetail} />
        </div>
      )}
    </li>
  );
}

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [detail, setDetail] = useState<Record<string, JobDetail> | Record<string, never>>({});
  const [status, setStatus] = useState<DiscoveryStatus | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // M12: error outcomes are surfaced (never silent) and every mutating
  // action tracks its in-flight state so buttons cannot double-submit.
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function markPending(key: string, value: boolean) {
    setPending((p) => ({ ...p, [key]: value }));
  }

  const loadJobs = useCallback(async (accountId: string) => {
    const r = await api<{ jobs: JobItem[] }>(`/account/${accountId}/jobs`);
    if (r.ok && r.body) setJobs(r.body.jobs);
    const s = await api<DiscoveryStatus>(`/account/${accountId}/discovery/status`);
    if (s.ok) setStatus(s.body as DiscoveryStatus);
    const st = await api<Strategy>(`/account/${accountId}/search-strategy`);
    if (st.ok && st.body) setStrategy(st.body);
  }, []);

  useEffect(() => {
    (async () => {
      const meRes = await api<Me>("/me");
      if (meRes.status === 200 && meRes.body) {
        setMe(meRes.body);
        await loadJobs(meRes.body.accountId);
        const d = await api<{ acknowledgements: Record<string, boolean> }>(
          `/account/${meRes.body.accountId}/disclosures`
        );
        if (d.status === 200 && d.body) setDisclosures(d.body.acknowledgements);
      }
      setChecked(true);
    })();
  }, [loadJobs]);

  async function acknowledge(key: string) {
    if (!me || pending[`ack:${key}`]) return;
    markPending(`ack:${key}`, true);
    setActionError(null);
    const r = await api(`/account/${me.accountId}/disclosures/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ disclosureKey: key })
    });
    markPending(`ack:${key}`, false);
    // No optimistic update: the acknowledgement is marked only on success.
    if (r.ok) setDisclosures((d) => ({ ...d, [key]: true }));
    else setActionError("Acknowledgement could not be recorded. Please try again.");
  }

  async function refreshNow() {
    if (!me || pending.refresh) return;
    markPending("refresh", true);
    setNotice(null);
    setActionError(null);
    const r = await api<{ state?: string; nextEligibleAt?: string }>(
      `/account/${me.accountId}/discovery/refresh`,
      { method: "POST", body: JSON.stringify({}) }
    );
    markPending("refresh", false);
    if (r.ok && r.body && "state" in r.body && r.body.state === "rejected_min_interval") {
      setNotice(`Refresh available after ${new Date(String(r.body.nextEligibleAt)).toLocaleTimeString()}`);
    } else if (r.ok) {
      setNotice("Discovery queued.");
    } else {
      setActionError("Refresh could not be queued. Please try again.");
    }
    await loadJobs(me.accountId);
  }

  async function review(jobId: string, state: string) {
    if (!me || pending[`review:${jobId}`]) return;
    markPending(`review:${jobId}`, true);
    setActionError(null);
    const r = await api(`/account/${me.accountId}/jobs/${jobId}/review`, {
      method: "POST",
      body: JSON.stringify({ state })
    });
    markPending(`review:${jobId}`, false);
    if (!r.ok) {
      setActionError("Review could not be saved. Please try again.");
      return;
    }
    await loadJobs(me.accountId);
  }

  async function toggleGenerated(term: string, enabled: boolean) {
    if (!me || pending[`term:${term}`]) return;
    markPending(`term:${term}`, true);
    setActionError(null);
    const r = await api<Strategy>(`/account/${me.accountId}/search-strategy`, {
      method: "PUT",
      body: JSON.stringify({ enableGenerated: [{ term, enabled }] })
    });
    markPending(`term:${term}`, false);
    // Roll back on failure by reloading the authoritative strategy.
    if (r.ok && r.body) setStrategy(r.body);
    else {
      setActionError("Search-strategy change could not be saved. Reloading.");
      await loadJobs(me.accountId);
    }
  }

  async function requestClosure() {
    if (!me || pending.closure) return;
    markPending("closure", true);
    setNotice(null);
    setActionError(null);
    // The fresh purpose-bound link is delivered by email; the dashboard only
    // reports that the confirmation step was sent.
    const r = await api(`/account/${me.accountId}/closure/request`, { method: "POST", body: "{}" });
    markPending("closure", false);
    if (r.status === 202) {
      setNotice("Closure confirmation link sent. Check your email. Access continues until you confirm.");
    } else {
      setActionError("Closure request could not be processed. Please try again.");
    }
  }

  const loadDetail = useCallback(
    async (jobId: string): Promise<JobDetail> => {
      if (detail[jobId]) return detail[jobId] as JobDetail;
      // M13: explicit sign-out guard instead of a `me!` crash race.
      if (!me) throw new Error("signed_out");
      const r = await api<JobDetail>(`/account/${me.accountId}/jobs/${jobId}/detail`);
      if (!r.ok || !r.body) throw new Error("detail_unavailable");
      const d = r.body;
      setDetail((prev) => ({ ...prev, [jobId]: d }));
      return d;
    },
    [detail, me]
  );


  if (!checked) return <main style={{ fontFamily: "system-ui", margin: "3rem" }}>Loadingâ€¦</main>;
  if (!me)
    return (
      <main style={{ fontFamily: "system-ui", margin: "3rem" }}>
        <p>Please sign in first.</p>
        <a href="/signin">Sign in â†’</a>
      </main>
    );

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 760, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>CareerPilot Dashboard</h1>

      {!disclosures["activation_notice"] && (
        <div style={{ border: "1px solid #888", padding: "0.75rem", marginBottom: "1rem" }}>
          <p>
            CareerPilot processes your career profile and matching data to discover and rank jobs.
            Your approved profile drives discovery; administrators have no routine access to your
            content; you can request closure at any time.
          </p>
          <button type="button" disabled={!!pending["ack:activation_notice"]} onClick={() => acknowledge("activation_notice")}>Acknowledge</button>
        </div>
      )}

      <h2>Discovery</h2>
      <p>
        Last run:{" "}
        {status?.run
          ? `${status.run.status}${status.run.completed_at ? ` (completed ${new Date(status.run.completed_at).toLocaleString()})` : ""}`
          : "no runs yet"}
        {status?.run?.status === "partial" && " â€” some sources failed; results are incomplete but usable."}
        {status?.run?.status === "running" && " â€” collection in progress."}
      </p>
      {status?.attempts?.map((a) => (
        <small key={a.job_source_slug} style={{ display: "block" }}>
          {a.job_source_slug}: {a.status}
        </small>
      ))}
      <button type="button" disabled={!!pending.refresh} onClick={refreshNow}>{pending.refresh ? "Refreshing…" : "Refresh now"}</button>
      {notice && (
        <p role="status" style={{ color: "#060" }}>
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" style={{ color: "#b00" }}>
          {actionError}
        </p>
      )}

      <h2>New jobs for you</h2>
      <ul style={{ padding: 0 }}>
        {jobs.map((j) => (
          <Job
            key={j.canonicalJobId}
            item={j}
            reviewPending={!!pending[`review:${j.canonicalJobId}`]}
            onReview={review}
            cachedDetail={detail[j.canonicalJobId] as JobDetail | undefined}
            loadDetail={loadDetail}
          />
        ))}
        {jobs.length === 0 && <li style={{ listStyle: "none" }}>No evaluated jobs yet.</li>}
      </ul>

      <h2>Search strategy</h2>
      {strategy && (
        <>
          <p>
            <small>{strategy.transparencyNotice}</small>
          </p>
          <ul>
            {strategy.terms.map((t) => (
              <li key={t.term}>
                <label>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    disabled={t.origin !== "generated"}
                    onChange={(e) => toggleGenerated(t.term, e.target.checked)}
                  />
                  {t.term} <small>({t.origin}{t.expandedFrom ? `, expanded from "${t.expandedFrom}"` : ""})</small>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Danger zone</h2>
      <p>
        Closing your account stops access immediately and deletes your data within 30 days.
        You will receive a fresh confirmation link by email.
      </p>
      <button type="button" disabled={!!pending.closure} onClick={requestClosure}>Request account closure</button>
    </main>
  );
}
