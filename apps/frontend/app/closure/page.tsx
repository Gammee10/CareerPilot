"use client";

import { useEffect, useState } from "react";

// Closure confirmation page: the FRESH, purpose-bound link lands here.
// Two-step (confirm -> redeem) per ADR-036; reuse fails safely.
export default function ClosurePage() {
  const [state, setState] = useState<"working" | "confirm" | "ready" | "done" | "failed">("working");
  const token = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;
  const [result, setResult] = useState<{ status?: string; deletionNotice?: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setState("failed");
      return;
    }
    (async () => {
      const confirm = await fetch("/api/auth/closure/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (confirm.status === 200) setState("confirm");
      else setState("failed");
    })();
  }, [token]);

  async function redeem() {
    if (!token) return;
    const res = await fetch("/api/auth/closure/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    const body = await res.json().catch(() => null);
    if (res.status === 200) {
      setResult(body);
      setState("done");
    } else {
      setState("failed");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Confirm account closure</h1>
      {state === "working" && <p>Validating your closure link…</p>}
      {state === "confirm" && (
        <>
          <p style={{ fontWeight: 600 }}>
            Warning: closing your account is permanent. Access stops immediately and
            your data will be deleted within 30 days. This cannot be undone.
          </p>
          <button onClick={redeem} style={{ background: "#b00", color: "#fff", padding: "0.6rem 1.2rem" }}>
            Close my account permanently
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
