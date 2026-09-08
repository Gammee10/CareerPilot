"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // M12: the request button cannot double-submit while a request is in flight.
  const [requesting, setRequesting] = useState(false);

  // M12: the single-use token is stripped from the URL as soon as it has
  // been consumed, so it never lingers in history, logs, or Referer headers.
  const stripToken = useCallback(() => {
    router.replace("/signin");
  }, [router]);

  useEffect(() => {
    if (!token) return;
    // Two-step redemption: confirm, then redeem (ADR-018).
    (async () => {
      // consumed = the server gave a definitive answer for this token, so it
      // is safe to strip it from the URL. Network failures keep the token so
      // the user can retry by reloading.
      let ok = false;
      let consumed = false;
      try {
        const confirm = await fetch("/api/auth/signin-link/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token })
        });
        if (confirm.status === 200) {
          const redeem = await fetch("/api/auth/signin-link/redeem", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ token })
          });
          consumed = true;
          ok = redeem.status === 200;
        } else {
          consumed = true;
        }
      } catch {
        ok = false;
      }
      if (consumed) stripToken();
      if (ok) {
        router.replace("/dashboard");
      } else {
        setError(true);
        setMessage("This sign-in link is invalid or has expired. Request a new one.");
      }
    })();
  }, [token, router, stripToken]);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    if (requesting) return;
    setRequesting(true);
    setError(false);
    setMessage(null);
    try {
      // L2: normalize client-side (server compares case-insensitively too);
      // credentials included on every fetch by convention, even anonymous ones.
      const res = await fetch("/api/auth/signin-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      if (res.status === 202) {
        setMessage("If the address is registered, a sign-in link is on its way.");
      } else {
        setError(true);
        setMessage("Sign-in could not be processed right now.");
      }
    } catch {
      setError(true);
      setMessage("Network error. Check your connection and try again.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <main id="main-content" style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign in to CareerPilot</h1>
      {token && !message ? (
        <p>Validating your secure link…</p>
      ) : (
        <>
          <p>
            Enter your email and we will send a one-time sign-in link. Opening the
            link is not enough — you will confirm before access is granted.
          </p>
          <form onSubmit={requestLink}>
            <label htmlFor="signin-email">Email address</label>
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem" }}
            />
            <button type="submit" disabled={requesting}>{requesting ? "Sending…" : "Send sign-in link"}</button>
          </form>
        </>
      )}
      {message && (
        <p role={error ? "alert" : "status"} style={{ color: error ? "#b00" : "#060" }}>
          {message}
        </p>
      )}
    </main>
  );
}

export default function SignInPageWithSuspense() {
  return (
    <Suspense fallback={<main style={{ fontFamily: "system-ui", margin: "3rem" }}>Loading…</main>}>
      <SignInInner />
    </Suspense>
  );
}
