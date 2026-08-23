import express from "express";
import { pingDatabase } from "./db.js";

const app = express();
app.disable("x-powered-by");

// Liveness: process is up. No dependency checks, no sensitive detail.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: authoritative datastore reachable.
app.get("/readyz", async (_req, res) => {
  try {
    const ok = await pingDatabase();
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

// All real routes arrive in later phases; unknown routes fail closed.
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

const server = app.listen(process.env.PORT ?? 8080, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "backend_listening",
    // Port only — no hostnames, credentials, or user data (ADR-015).
    port: Number(process.env.PORT ?? 8080)
  }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
