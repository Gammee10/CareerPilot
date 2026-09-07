import { config } from "./config.js";
import { getPool } from "./db.js";
import { buildApp } from "./app.js";
import { LoggingMailer, ResendMailer, type Mailer } from "./notify/mailer.js";

function selectMailer(): Mailer {
  const resend = ResendMailer.fromSecretFile();
  if (resend) return resend;
  if (config.nodeEnv === "production") {
    // Operational failure, not a crash with a stack: passwordless flows
    // cannot deliver without the Vault-provided Resend key (ADR-056).
    console.error(
      "missing resend_api_key secret file; refusing to boot in production"
    );
    process.exit(1);
  }
  return new LoggingMailer();
}

const app = buildApp({ db: getPool(), mailer: selectMailer() });

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
