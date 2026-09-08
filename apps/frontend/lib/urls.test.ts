// H14: untrusted listing URLs must never become executable hrefs.
import { describe, expect, it } from "vitest";
import { isSafeHttpUrl } from "./urls";

describe("isSafeHttpUrl (H14)", () => {
  it("allows plain https links", () => {
    expect(isSafeHttpUrl("https://ats.example.com/jobs/123")).toBe(true);
    expect(isSafeHttpUrl("  https://example.com/a?b=c  ")).toBe(true);
  });

  it("rejects executable schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects http (downgrade risk) and non-URLs", () => {
    expect(isSafeHttpUrl("http://example.com/job")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("/relative/path")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });
});
