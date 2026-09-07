import { describe, expect, it, vi } from "vitest";
import { ResendMailer } from "../src/notify/mailer.js";

function okFetch(calls: unknown[]) {
  return vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("ResendMailer (C3)", () => {
  it("sends invitation and sign-in link through the Resend API", async () => {
    const calls: unknown[] = [];
    const mailer = new ResendMailer("test-key", "CareerPilot <no-reply@test>", okFetch(calls));
    await mailer.sendInvitation("user@example.com", "https://app/invite?t=1");
    await mailer.sendSignInLink("user@example.com", "https://app/signin?t=2");
    expect(calls).toHaveLength(2);
    for (const call of calls as Array<{ url: unknown; init: { headers: Record<string, string>; body: string } }>) {
      expect(call.url).toBe("https://api.resend.com/emails");
      expect(call.init.headers.authorization).toBe("Bearer test-key");
      const body = JSON.parse(call.init.body) as { to: string[]; from: string };
      expect(body.to).toEqual(["user@example.com"]);
      expect(body.from).toContain("CareerPilot");
    }
  });

  it("retries once on 5xx then succeeds", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      if (n === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ id: "msg_2" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = new ResendMailer("k", "f", fetchFn);
    await mailer.sendClosureConfirmation("a@b.c", "https://app/closure?t=3");
    expect(n).toBe(2);
  });

  it("does not retry on 4xx and throws email_unavailable", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      return new Response("bad", { status: 400 });
    }) as unknown as typeof fetch;
    const mailer = new ResendMailer("k", "f", fetchFn);
    await expect(mailer.sendInvitation("a@b.c", "https://x")).rejects.toThrow("email_unavailable");
    expect(n).toBe(1);
  });

  it("fromSecretFile returns null when the key file is absent", () => {
    expect(
      ResendMailer.fromSecretFile("/nonexistent-resend-key-c3-test")
    ).toBeNull();
  });
});
