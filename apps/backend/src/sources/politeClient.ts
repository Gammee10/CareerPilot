// Conservative source-collection HTTP client (ADR-044/059): ~1 sustained
// request/second, bounded attempts, Retry-After honored, short timeout.
// Transport and clock are injectable for deterministic tests.
export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type Transport = (url: string) => Promise<HttpResponse>;

export type Sleep = (ms: number) => Promise<void>;

export type PoliteOptions = {
  minIntervalMs?: number;   // sustained rate cap (ADR-059: ~1 req/s)
  maxAttempts?: number;     // ADR-044: at most three attempts
  retryAfterCapMs?: number; // never sleep longer than this on Retry-After
};

const DEFAULTS = { minIntervalMs: 1000, maxAttempts: 3, retryAfterCapMs: 60_000 };

export class NonTransientError extends Error {
  constructor(public status: number) {
    super(`non_transient_http_${status}`);
  }
}

export class AttemptsExhaustedError extends Error {
  constructor(public lastStatus?: number) {
    super("attempts_exhausted");
  }
}

export class PoliteClient {
  private lastRequestAt = -Infinity;

  constructor(
    private readonly transport: Transport,
    private readonly sleep: Sleep,
    private readonly now: () => number,
    private readonly opts: PoliteOptions = {}
  ) {}

  async getJson<T>(url: string): Promise<{ data: T; attempts: number }> {
    const { minIntervalMs, maxAttempts, retryAfterCapMs } = { ...DEFAULTS, ...this.opts };
    let attempts = 0;
    while (true) {
      // Sustained-rate enforcement before every request.
      const nowMs = this.now();
      const earliest = this.lastRequestAt + minIntervalMs;
      if (earliest > nowMs) await this.sleep(earliest - nowMs);
      const waitUntil = this.now() + minIntervalMs;
      this.lastRequestAt = Math.max(this.now(), this.lastRequestAt + minIntervalMs);
      void waitUntil;

      attempts += 1;
      const res = await this.transport(url);

      if (res.status === 200) {
        return { data: JSON.parse(res.body) as T, attempts };
      }

      if ((res.status === 429 || res.status === 503) && attempts < maxAttempts) {
        // Honor source-provided retry timing, capped (ADR-044).
        const retryAfterHeader =
          res.headers["retry-after"] ?? res.headers["Retry-After"] ?? null;
        const seconds = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
        const delay = Number.isFinite(seconds)
          ? Math.min(seconds * 1000, retryAfterCapMs)
          : Math.min(minIntervalMs * attempts, retryAfterCapMs);
        await this.sleep(delay);
        continue;
      }

      if (attempts >= maxAttempts) throw new AttemptsExhaustedError(res.status);
      if ([500, 502, 504].includes(res.status)) {
        await this.sleep(minIntervalMs * attempts); // transient server error
        continue;
      }
      throw new NonTransientError(res.status); // auth/policy/invalid — not retried
    }
  }
}

/** Page-budgeted pagination helper (ADR-059 bounded result pages). */
export async function collectPages<T>(
  client: PoliteClient,
  pageBudget: number,
  fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>
): Promise<{ items: T[]; pagesFetched: number }> {
  const items: T[] = [];
  let pagesFetched = 0;
  for (let page = 1; page <= pageBudget; page++) {
    const result = await fetchPage(page);
    pagesFetched += 1;
    items.push(...result.items);
    if (!result.hasMore) break;
  }
  return { items, pagesFetched };
}
