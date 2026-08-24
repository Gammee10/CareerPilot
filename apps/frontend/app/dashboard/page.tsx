"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

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

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [detail, setDetail] = useState<Record<string, JobDetail> | Record<string, never>>({});
  const [status, setStatus] = useState<DiscoveryStatus | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const loadJobs = useCallback(async (accountId: string) => {
    const r = await api<{ jobs: JobItem[] }>(`/account/${accountId}/jobs`);
    if (r.status === 200 && r.body) setJobs(r.body.jobs);
    const s = await api<DiscoveryStatus>(`/account/${accountId}/discovery/status`);
    if (s.status === 200) setStatus(s.body as DiscoveryStatus);
    const st = await api<Strategy>(`/account/${accountId}/search-strategy`);
    if (st.status === 200) setStrategy(st.body as Strategy);
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
    if (!me) return;
    await api(`/account/${me.accountId}/disclosures/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ disclosureKey: key })
    });
    setDisclosures((d) => ({ ...d, [key]: true }));
  }

  async function refreshNow() {
    if (!me) return;
    const r = await api<{ state?: string; nextEligibleAt?: string }>(
      `/account/${me.accountId}/discovery/refresh`,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (r.body && "state" in r.body && r.body.state === "rejected_min_interval") {
      setNotice(`Refresh available after ${new Date(String(r.body.nextEligibleAt)).toLocaleTimeString()}`);
    } else {
      setNotice("Discovery queued.");
    }
    await loadJobs(me.accountId);
  }

  async function review(jobId: string, state: string) {
    if (!me) return;
    await api(`/account/${me.accountId}/jobs/${jobId}/review`, {
      method: "POST",
      body: JSON.stringify({ state })
    });
    await loadJobs(me.accountId);
  }

  async function toggleGenerated(term: string, enabled: boolean) {
    if (!me) return;
    const r = await api<Strategy>(`/account/${me.accountId}/search-strategy`, {
      method: "PUT",
      body: JSON.stringify({ enableGenerated: [{ term, enabled }] })
    });
    if (r.status === 200 && r.body) setStrategy(r.body);
  }

  async function requestClosure() {
    if (!me) return;
    // The fresh purpose-bound link is delivered by email; the dashboard only
    // reports that the confirmation step was sent.
    const r = await api(`/account/${me.accountId}/closure/request`, { method: "POST", body: "{}" });
    setNotice(
      r.status === 202
        ? "Closure confirmation link sent. Check your email â€” access continues until you confirm."
        : "Closure request could not be processed."
    );
  }

  async function loadDetail(jobId: string): Promise<JobDetail> {
    if (detail[jobId]) return detail[jobId] as JobDetail;
    const r = await api<JobDetail>(`/account/${me!.accountId}/jobs/${jobId}/detail`);
    const d = r.body as JobDetail;
    setDetail((prev) => ({ ...prev, [jobId]: d }));
    return d;
  }

  function DetailRow({ jobId }: { jobId: string }) {
    const [d, setD] = useState<JobDetail | null>((detail[jobId] as JobDetail) ?? null);
    useEffect(() => {
      loadDetail(jobId).then(setD).catch(() => undefined);
    }, [jobId]);
    if (!d) return <p>Loading detailâ€¦</p>;
    return (
      <div style={{ background: "#f6f6f6", padding: "0.75rem", marginTop: "0.5rem" }}>
        <p>
          Eligibility: <strong>{d.eligibility ?? "pending evaluation"}</strong>
          {d.constraintFailures.map((f) => (
            <span key={f.constraint}> Â· excluded: {f.detail}</span>
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
          <a href={d.preferredApplicationUrl ?? "#"} target="_blank" rel="noreferrer">
            primary application link
          </a>
          {d.alternativeApplicationUrls.map((u) => (
            <span key={u}>
              {" Â· "}
              <a href={u} target="_blank" rel="noreferrer">
                alternative
              </a>
            </span>
          ))}
          {d.restrictions.length > 0 && <small> Â· source obligations: {d.restrictions.join(", ")}</small>}
        </p>
      </div>
    );
  }

  function Job({ item }: { item: JobItem }) {
    const [open, setOpen] = useState(false);
    return (
      <li style={{ marginBottom: "1rem", listStyle: "none", borderBottom: "1px solid #ddd", paddingBottom: "0.75rem" }}>
        <strong>{item.title ?? "(untitled)"}</strong> â€” {item.company} Â· {item.location}
        <br />
        <small>
          score {item.score ?? "â€”"} Â· eligibility {item.eligibility ?? "pending"} Â· availability{" "}
          {item.availability} Â· {item.reviewState}
          {item.pendingReevaluation && " Â· re-evaluation pending"}
        </small>
        <br />
        <button onClick={() => setOpen(!open)}>{open ? "Hide details" : "Why this job?"}</button>{" "}
        {item.reviewState === "new" && (
          <button onClick={() => review(item.canonicalJobId, "seen")}>Mark seen</button>
        )}
        {item.reviewState === "seen" && (
          <>
            <button onClick={() => review(item.canonicalJobId, "saved")}>Save</button>
            <button onClick={() => review(item.canonicalJobId, "not_interested")}>Not interested</button>
          </>
        )}
        {open && <DetailRow jobId={item.canonicalJobId} />}
      </li>
    );
  }

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
          <button onClick={() => acknowledge("activation_notice")}>Acknowledge</button>
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
      <button onClick={refreshNow}>Refresh now</button>
      {notice && (
        <p role="status" style={{ color: "#060" }}>
          {notice}
        </p>
      )}

      <h2>New jobs for you</h2>
      <ul style={{ padding: 0 }}>
        {jobs.map((j) => (
          <Job key={j.canonicalJobId} item={j} />
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
      <button onClick={requestClosure}>Request account closureâ€¦</button>
    </main>
  );
}
