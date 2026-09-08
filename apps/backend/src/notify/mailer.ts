// Transactional-email boundary (ADR-003/052). Phase 2 ships the interface
// plus a minimized logging implementation; Resend delivery integration is
// wired in operations work. Recipient addresses and token URLs are NEVER
// logged here — only the fact of a send attempt.
import { readSecretFile } from "../config.js";

export interface Mailer {
  sendInvitation(email: string, url: string): Promise<void>;
  sendSignInLink(email: string, url: string): Promise<void>;
  sendClosureConfirmation(email: string, url: string): Promise<void>;
}

export class LoggingMailer implements Mailer {
  async sendInvitation(_email: string, _url: string): Promise<void> {
    console.log(JSON.stringify({ event: "mailer_invitation_send" }));
  }
  async sendSignInLink(_email: string, _url: string): Promise<void> {
    console.log(JSON.stringify({ event: "mailer_signin_link_send" }));
  }
  async sendClosureConfirmation(_email: string, _url: string): Promise<void> {
    console.log(JSON.stringify({ event: "mailer_closure_send" }));
  }
}

// Test-only capture mailer. Never used in production wiring.
export class CaptureMailer implements Mailer {
  invitations: Array<{ email: string; url: string }> = [];
  signInLinks: Array<{ email: string; url: string }> = [];
  closureConfirmations: Array<{ email: string; url: string }> = [];

  async sendInvitation(email: string, url: string): Promise<void> {
    this.invitations.push({ email, url });
  }
  async sendSignInLink(email: string, url: string): Promise<void> {
    this.signInLinks.push({ email, url });
  }
  async sendClosureConfirmation(email: string, url: string): Promise<void> {
    this.closureConfirmations.push({ email, url });
  }
}

// Production mailer over the Resend HTTP API (restricted transactional email
// + administrator operational alerts per ADR-052 as amended). The API key is
// read from a file-mounted Compose secret — never from an env value — and
// recipient addresses / token URLs are never logged (ADR-015).
export class ResendMailer implements Mailer {
  static readonly apiUrl = "https://api.resend.com/emails";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  // Returns null when the key file is absent so callers can fall back to the
  // dev/test double (or fail boot in production with an operational message).
  static fromSecretFile(
    file = process.env.RESEND_API_KEY_FILE ?? "/run/secrets/resend_api_key",
    from = process.env.EMAIL_FROM ?? "CareerPilot <no-reply@localhost>",
    fetchFn: typeof fetch = fetch
  ): ResendMailer | null {
    // L4: shared reader; absent/empty key means "no Resend" (dev fallback or
    // production boot refusal in server.ts) — never a raw ENOENT.
    try {
      return new ResendMailer(readSecretFile(file, "resend_api_key"), from, fetchFn);
    } catch {
      return null;
    }
  }

  async sendInvitation(email: string, url: string): Promise<void> {
    await this.send(email, "Your CareerPilot invitation", `Accept your invitation: ${url}`);
  }

  async sendSignInLink(email: string, url: string): Promise<void> {
    await this.send(email, "Your CareerPilot sign-in link", `Sign in: ${url}`);
  }

  async sendClosureConfirmation(email: string, url: string): Promise<void> {
    await this.send(email, "Confirm CareerPilot account closure", `Confirm closure: ${url}`);
  }

  private async send(email: string, subject: string, text: string): Promise<void> {
    // One bounded retry on 429/5xx only; 4xx (except 429) never retried.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(
          ResendMailer.apiUrl,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({ from: this.from, to: [email], subject, text }),
            signal: AbortSignal.timeout(10_000)
          }
        );
      } catch {
        // Network/timeout: exactly one retry, then a minimized failure.
        if (attempt === 0) continue;
        console.log(JSON.stringify({ event: "mailer_send_failed", reason: "network" }));
        throw new Error("email_unavailable");
      }
      lastStatus = res.status;
      if (res.ok) return;
      if (res.status === 429 || res.status >= 500) continue;
      console.log(JSON.stringify({ event: "mailer_send_failed", status: res.status }));
      throw new Error("email_unavailable");
    }
    console.log(JSON.stringify({ event: "mailer_send_failed", status: lastStatus }));
    throw new Error("email_unavailable");
  }
}
