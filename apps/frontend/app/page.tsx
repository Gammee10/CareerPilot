"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Me = { accountId: string; isAdmin: boolean };

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api<Me>("/me").then((r) => {
      if (r.status === 200) setMe(r.body);
      setChecked(true);
    });
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>CareerPilot</h1>
      {!checked ? (
        <p>Loading…</p>
      ) : me ? (
        <>
          <p>Signed in.</p>
          <a href="/dashboard">Go to dashboard →</a>
        </>
      ) : (
        <>
          <p>Invite-only, passwordless access. Sign in with a one-time email link.</p>
          <a href="/signin">Sign in →</a>
        </>
      )}
    </main>
  );
}
