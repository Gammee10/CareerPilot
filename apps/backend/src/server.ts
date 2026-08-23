import { config } from "./config.js";
import { getPool } from "./db.js";
import { buildApp } from "./app.js";
import { LoggingMailer } from "./notify/mailer.js";

const app = buildApp({ db: getPool(), mailer: new LoggingMailer() });

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "backend_listening",
    // Port only — no hostnames, credentials, or user data (ADR-015).
    port: config.port
  }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
