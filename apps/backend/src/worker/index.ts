// Background-work runtime role (ADR-008/049). Phase 1 placeholder: verifies
// datastore reachability and exposes a private health endpoint so the
// Compose baseline can supervise it. Durable pg-boss work arrives in T5.1.

import http from "node:http";
import { config } from "../config.js";
import { pingDatabase } from "../db.js";

let dbOk = false;

const health = http.createServer((_req, res) => {
  res.writeHead(dbOk ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: dbOk ? "ok" : "degraded" }));
});
health.listen(config.workerHealthPort, "0.0.0.0");

async function verifyAndStart(): Promise<void> {
  try {
    dbOk = await pingDatabase();
    console.log(JSON.stringify({ event: "worker_ready", db_reachable: dbOk }));
  } catch {
    dbOk = false;
    console.log(JSON.stringify({ event: "worker_db_unreachable" }));
  }
}

await verifyAndStart();
setInterval(verifyAndStart, 30_000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => process.exit(0));
}
