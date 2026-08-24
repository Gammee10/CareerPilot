// Structured JSON logging with correlation IDs (T8.1, ADR-015/058).
// Minimization is enforced by convention + review: callers pass metadata
// only (events, ids, counts, codes). Resume/profile/job/AI content must
// never be passed as fields — the log-scan test enforces this over a full
// simulated user journey.
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

type CorrelationContext = { correlationId: string; workUnitId?: string };

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Runs `fn` inside a correlation scope; every log line carries the id. */
export async function withCorrelation<T>(
  fn: (correlationId: string) => Promise<T>
): Promise<T> {
  const correlationId = randomUUID();
  return storage.run({ correlationId }, () => fn(correlationId));
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const ctx = storage.getStore();
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    ...(ctx?.workUnitId ? { workUnitId: ctx.workUnitId } : {}),
    ...fields
  };
  console.log(JSON.stringify(line));
}

/** Attaches a work-unit identifier to an existing correlation scope. */
export function withWorkUnit<T>(workUnitId: string, fn: () => T): T {
  const ctx = storage.getStore() ?? { correlationId: randomUUID() };
  return storage.run({ ...ctx, workUnitId }, fn);
}
