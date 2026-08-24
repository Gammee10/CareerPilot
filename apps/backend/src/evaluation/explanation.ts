// Evidence-linked explanation validation (T6.3, FR-20/23).
// AI-proposed explanations are untrusted: every claim must cite evidence
// refs that exist in the job's named structured fields / description excerpt;
// required-qualification claims without evidence are rejected.

export type EvidenceMap = Record<string, { field: string; value: string }>;

export type ClaimKind =
  | "strength"
  | "gap"
  | "exclusion"
  | "uncertainty"
  | "requirement";

export type ExplanationClaim = {
  statement: string;
  kind: ClaimKind;
  confidence: "confirmed" | "inferred" | "uncertain";
  evidenceRefs: string[];
};

export function validateExplanation(
  raw: unknown,
  evidence: EvidenceMap
): { ok: true; claims: ExplanationClaim[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "not_an_array" };
  if (raw.length > 30) return { ok: false, reason: "too_many_claims" };

  const claims: ExplanationClaim[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "claim_not_object" };
    }
    const c = entry as Record<string, unknown>;
    if (typeof c.statement !== "string" || c.statement.trim().length === 0 || c.statement.length > 500) {
      return { ok: false, reason: "invalid_statement" };
    }
    const kinds = ["strength", "gap", "exclusion", "uncertainty", "requirement"];
    if (!kinds.includes(String(c.kind))) return { ok: false, reason: "invalid_kind" };
    const confidences = ["confirmed", "inferred", "uncertain"];
    if (!confidences.includes(String(c.confidence))) {
      return { ok: false, reason: "invalid_confidence" };
    }
    if (
      !Array.isArray(c.evidenceRefs) ||
      c.evidenceRefs.some((r) => typeof r !== "string")
    ) {
      return { ok: false, reason: "invalid_evidence_refs" };
    }

    const refs = c.evidenceRefs as string[];
    // Every cited ref must exist in the job's actual evidence set.
    for (const ref of refs) {
      if (!(ref in evidence)) {
        return { ok: false, reason: `unsupported_evidence_ref:${ref}` };
      }
    }
    // Required-qualification claims MUST cite evidence (T6.3 AC).
    if ((c.kind as string) === "requirement" && refs.length === 0) {
      return { ok: false, reason: "requirement_claim_without_evidence" };
    }
    claims.push({
      statement: c.statement,
      kind: c.kind as ClaimKind,
      confidence: c.confidence as ExplanationClaim["confidence"],
      evidenceRefs: refs
    });
  }
  return { ok: true, claims };
}
