// Same-origin API access (through Caddy in deployment). Credentials are
// always included so the httpOnly session cookie flows.
export async function api<T>(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as T) : null
  };
}
