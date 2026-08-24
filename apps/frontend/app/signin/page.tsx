"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Two-step redemption: confirm, then redeem (ADR-018).
    (async () => {
      const confirm = await fetch("/api/auth/signin-link/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token })
      });
      if (confirm.status !== 200) {
        setError(true);
        setMessage("This sign-in link is invalid or has expired. Request a new one.");
        return;
      }
      const redeem = await fetch("/api/auth/signin-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token })
      });
      if (redeem.status === 200) {
        router.replace("/dashboard");
      } else {
        setError(true);
        setMessage("This sign-in link is invalid or has expired.");
      }
    })();
  }, [token, router]);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/signin-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (res.status === 202) {
      setMessage("If the address is registered, a sign-in link is on its way.");
    } else {
      setMessage("Sign-in could not be processed right now.");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
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
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem" }}
            />
            <button type="submit">Send sign-in link</button>
          </form>
        </>
      )}
      {message && (
        <p role="status" style={{ color: error ? "#b00" : "#060" }}>
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
