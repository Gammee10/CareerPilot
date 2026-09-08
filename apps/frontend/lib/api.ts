// M12: centralized fetch wrapper. Network failure, timeout, and malformed
// bodies resolve to a caller-handled outcome — never an unhandled rejection
// or a JSON.parse throw. 401 means the session is gone: redirect to sign-in.
export type ApiResult<T> =
  | { ok: true; status: number; body: T | null }
  | { ok: false; status: number; body: null; error: "network" | "timeout" | "bad_body" | "http" };

const TIMEOUT_MS = 15000;

export async function api<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      ...init
    });
  } catch (err) {
    const timedOut =
      err instanceof DOMException
        ? err.name === "TimeoutError"
        : err instanceof Error && err.name === "TimeoutError";
    return { ok: false, status: 0, body: null, error: timedOut ? "timeout" : "network" };
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/signin";
    return { ok: false, status: 401, body: null, error: "http" };
  }
  const text = await res.text().catch(() => null);
  if (text === null) return { ok: false, status: res.status, body: null, error: "network" };
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      return { ok: false, status: res.status, body: null, error: "bad_body" };
    }
  }
  if (!res.ok) return { ok: false, status: res.status, body: null, error: "http" };
  return { ok: true, status: res.status, body };
}
