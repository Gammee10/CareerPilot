// Transactional-email boundary (ADR-003/052). Phase 2 ships the interface
// plus a minimized logging implementation; Resend delivery integration is
// wired in operations work. Recipient addresses and token URLs are NEVER
// logged here — only the fact of a send attempt.
export interface Mailer {
  sendInvitation(email: string, url: string): Promise<void>;
  sendSignInLink(email: string, url: string): Promise<void>;
}

export class LoggingMailer implements Mailer {
  async sendInvitation(_email: string, _url: string): Promise<void> {
    console.log(JSON.stringify({ event: "mailer_invitation_send" }));
  }
  async sendSignInLink(_email: string, _url: string): Promise<void> {
    console.log(JSON.stringify({ event: "mailer_signin_link_send" }));
  }
}

// Test-only capture mailer. Never used in production wiring.
export class CaptureMailer implements Mailer {
  invitations: Array<{ email: string; url: string }> = [];
  signInLinks: Array<{ email: string; url: string }> = [];

  async sendInvitation(email: string, url: string): Promise<void> {
    this.invitations.push({ email, url });
  }
  async sendSignInLink(email: string, url: string): Promise<void> {
    this.signInLinks.push({ email, url });
  }
}
