// AI capability client boundary (ADR-047/054). The Node-owned path builds
// the minimized task, sends it to the internal FastAPI capability, and
// treats every response as an untrusted proposal until validated here.
import type { ExtractionTask } from "./minimization.js";

export interface AiClient {
  requestExtraction(task: ExtractionTask): Promise<unknown>;
}

export type AiFailure = "unavailable" | "malformed_output";

// Production client: posts the already-minimized task to the internal,
// non-public FastAPI capability. No CareerPilot identifiers are attached.
export class HttpAiClient implements AiClient {
  constructor(private readonly baseUrl: string) {}

  async requestExtraction(task: ExtractionTask): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task)
    });
    if (!res.ok) throw new Error(`ai_unavailable:${res.status}`);
    const json = await res.json();
    return json?.proposal;
  }
}
