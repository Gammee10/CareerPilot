// M12: the wrapper never throws and never trusts the body.
import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, text: string) {
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("api() error handling (M12)", () => {
  it("resolves ok on 200 with JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, '{"a":1}')));
    const r = await api<{ a: number }>("/me");
    expect(r).toEqual({ ok: true, status: 200, body: { a: 1 } });
  });

  it("maps network failure to error=network (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const r = await api("/me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("network");
  });

  it("maps aborts to error=timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    }));
    const r = await api("/me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("timeout");
  });

  it("maps malformed bodies to error=bad_body (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, "not-json{")));
    const r = await api("/me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("bad_body");
  });

  it("maps HTTP failures to error=http without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, '{"error":"x"}')));
    const r = await api("/me");
    expect(r).toEqual({ ok: false, status: 500, body: null, error: "http" });
  });

  it("sends a timeout signal with mutating requests", async () => {
    let seenInit: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse(200, "{}");
    }));
    await api("/x", { method: "POST", body: "{}" });
    expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
  });
});
