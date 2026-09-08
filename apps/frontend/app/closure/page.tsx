"use client";

import { useEffect, useState } from "react";

// Closure confirmation page: the FRESH, purpose-bound link lands here.
// Two-step (confirm -> redeem) per ADR-036; reuse fails safely.
export default function ClosurePage() {
  const token = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;
  // M13: missing-token failure is the initial state, not a sync setState
  // inside the effect.
  const [state, setState] = useState<"working" | "confirm" | "ready" | "done" | "failed">(
    token ? "working" : "failed"
  );  const [result, setResult] = useState<{ status?: string; deletionNotice?: string } | null>(null);
  // M12: the destructive action cannot double-submit while in flight.
  const [redeeming, setRedeeming] = useState(false);

  // M12: strip the single-use token once consumed so it never lingers in
  // history, logs, or Referer headers. Network failures keep it for retry.
  function stripToken() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const confirm = await fetch("/api/auth/closure/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token })
        });
        if (confirm.status === 200) setState("confirm");
        else {
          stripToken();
          setState("failed");
        }
      } catch {
        setState("failed");
      }
    })();
  }, [token]);

  async function redeem() {
    if (!token || redeeming) return;
    setRedeeming(true);
    try {
      const res = await fetch("/api/auth/closure/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token })
      });
      stripToken();
      const body = await res.json().catch(() => null);
      if (res.status === 200) {
        setResult(body);
        setState("done");
      } else {
        setState("failed");
      }
    } catch {
      setState("failed");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <main id="main-content" style={{ fontFamily: "system-ui", maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Confirm account closure</h1>
      {state === "working" && <p>Validating your closure link…</p>}
      {state === "confirm" && (
        <>
          <p style={{ fontWeight: 600 }}>
            Warning: closing your account is permanent. Access stops immediately and
            your data will be deleted within 30 days. This cannot be undone.
          </p>
          <button type="button" disabled={redeeming} onClick={redeem} style={{ background: "#b00", color: "#fff", padding: "0.6rem 1.2rem" }}>
            {redeeming ? "Closing…" : "Close my account permanently"}
          </button>
        </>
      )}
      {state === "done" && result && (
        <p role="status">{result.deletionNotice}</p>
      )}
      {state === "failed" && (
        <p role="alert">This closure link is invalid, expired, or already used.</p>
      )}
    </main>
  );
}
