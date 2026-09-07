// AI capability client boundary (ADR-047/054). The Node-owned path builds
// the minimized task, sends it to the internal FastAPI capability, and
// treats every response as an untrusted proposal until validated here.
import fs from "node:fs";
import type { ExtractionTask } from "./minimization.js";

export interface AiClient {
  requestExtraction(task: ExtractionTask): Promise<unknown>;
}

export type AiFailure = "unavailable" | "malformed_output";

// Production client: posts the already-minimized task to the internal,
// non-public FastAPI capability. No CareerPilot identifiers are attached.
export class HttpAiClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken?: string
  ) {}

  private resolvedToken(): string | null {
    if (this.internalToken) return this.internalToken;
    // File-mounted Compose secret (ADR-056); absent in dev/test doubles.
    try {
      const file = process.env.AI_INTERNAL_TOKEN_FILE ?? "/run/secrets/ai_internal_token";
      return fs.readFileSync(file, "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  async requestExtraction(task: ExtractionTask): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = this.resolvedToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl}/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify(task)
    });
    // M14: transient-vs-nontransient mapping for ADR-044. Rejections of the
    // task itself (identifier tripwire 400, shape validation 422) are never
    // retried — the task would be rejected identically on redelivery.
    if (res.status === 400 || res.status === 422) throw new Error("ai_rejected_task");
    if (!res.ok) throw new Error(`ai_unavailable:${res.status}`);
    const json = await res.json();
    return json?.proposal;
  }
}
