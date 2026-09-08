"use client";

// O4: global error boundary — a crashed route renders a truthful,
// retryable message instead of a blank page. Segment-level errors bubble
// here; data-fetch failures are handled per-page with role="alert".
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: "3rem" }}>
        <h1>Something went wrong</h1>
        <p role="alert">This page could not be displayed. Your data is unaffected.</p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
