// Hybrid evaluation engine (T6.1â€“T6.4): deterministic constraints run FIRST
// and gate everything; AI interpretation is optional, minimized, validated,
// and can never override a deterministic rejection.
import type { Pool } from "pg";
import type { AiClient } from "../profile/aiClient.js";
import { loadJobView, type EvidenceMap } from "./jobFacts.js";
import { evaluateHardConstraints, type ProfileSetting } from "./constraints.js";
import { scoreJob } from "./scoring.js";
import { validateExplanation, type ExplanationClaim } from "./explanation.js";
import {
  createEvaluationSnapshot,
  MATCHING_POLICY_VERSION
} from "./snapshot.js";
import { getCurrentCompatibleEvaluation } from "./snapshot.js";
import type { ProfileContent } from "../profile/profileVersions.js";
import { redactIdentifiers } from "../profile/minimization.js";

export type EvaluationResult =
  | { ok: true; evaluationId: string; eligibility: string; aiUsed: boolean }
  | { ok: false; reason: "job_not_found" | "profile_missing" };

export async function evaluateJobForUser(
  db: Pool,
  accountId: string,
  canonicalJobId: string,
  now: Date,
  ai?: AiClient
): Promise<EvaluationResult> {
  const view = await loadJobView(db, canonicalJobId);
  if (!view) return { ok: false, reason: "job_not_found" };

  const profileRow = await db.query<{ current_profile_version_id: string | null }>(
    "SELECT current_profile_version_id FROM career_profiles WHERE account_id = $1",
    [accountId]
  );
  const profileVersionId = profileRow.rows[0]?.current_profile_version_id ?? null;
  if (!profileVersionId) return { ok: false, reason: "profile_missing" };

  const pv = await db.query<{ content: unknown }>(
    "SELECT content FROM profile_versions WHERE id = $1",
    [profileVersionId]
  );
  const profile = (pv.rows[0]?.content ?? {}) as ProfileContent;
  const settings = (profile.settings ?? {}) as Record<string, ProfileSetting>;

  // ---- Stage 1: DETERMINISTIC constraints (authoritative, always first) ----
  const constraints = evaluateHardConstraints(settings, view.facts);

  // ---- Stage 2 (optional): AI explanation proposals ----
  // Input is minimized structured job text; identifiers are redacted before
  // leaving CareerPilot (ADR-054). Malformed/unavailable AI output simply
  // degrades to deterministic results with uncertainty labels.
  let claims: ExplanationClaim[] = [];
  let aiUsed = false;
  if (ai && constraints.status !== "ineligible") {
    try {
      const minimizedJob = redactIdentifiers(
        JSON.stringify({
          title: view.facts.title,
          location: view.facts.location,
          company: view.facts.company
        }),
        { knownAccountIds: [accountId] }
      );
      const raw = await ai.requestExtraction({
        task: "resume_extraction",
        content: `INTERPRET_JOB ${minimizedJob}`
      });
      const validated = validateExplanation(raw, view.evidence as EvidenceMap);
      if (validated.ok) {
        claims = validated.claims;
        aiUsed = true;
      }
    } catch {
      // AI unavailable â†’ deterministic-only result with uncertainty labels.
    }
  }

  // ---- Stage 3: scoring with transparent penalties ----
  const scoring = scoreJob({
    constraintStatus: constraints.status,
    unknownConstraints: constraints.unknowns,
    title: view.facts.title,
    targetRole:
      typeof (profile as Record<string, unknown>)["target_role"] === "string"
        ? ((profile as Record<string, unknown>)["target_role"] as string)
        : null,
    profileSkills: Array.isArray(profile.skills) ? (profile.skills as string[]) : [],
    descriptionText: null, // structured description storage arrives with Phase-4 depth work
    remoteInferred: view.facts.remoteInferred,
    remoteOnlyPreferred: settings["remote_only"]?.classification === "hard_constraint",
    salaryDisclosed: view.facts.salaryMin !== null,
    priorities: readPriorities(profile)
  });

  // Deterministic exclusions become confirmed exclusion claims citing the
  // named structured fields that produced them (FR-23).
  const exclusionClaims = constraints.failures.map((f) => ({
    statement: f.detail,
    kind: "exclusion" as const,
    confidence: "confirmed" as const,
    evidenceRefs: ["field:location", "field:company", "field:title"].filter(
      (r) => r in view.evidence
    )
  }));
  const uncertaintyClaims = [
    ...constraints.unknowns.map((u) => ({
      statement: u.detail,
      kind: "uncertainty" as const,
      confidence: "uncertain" as const,
      evidenceRefs: []
    })),
    ...(!aiUsed && constraints.status !== "ineligible"
      ? [{
          statement: "AI interpretation unavailable; assessment limited to structured fields",
          kind: "uncertainty" as const,
          confidence: "uncertain" as const,
          evidenceRefs: []
        }]
      : [])
  ];
  const explanation = [...exclusionClaims, ...uncertaintyClaims, ...claims];

  const eligibility =
    constraints.status === "ineligible"
      ? "ineligible"
      : constraints.status === "unverified"
        ? "unverified"
        : "confirmed";

  void MATCHING_POLICY_VERSION;
  const evaluationId = await createEvaluationSnapshot(
    db,
    {
      accountId,
      canonicalJobId,
      profileVersionId,
      inputObservationId: view.latestObservationId,
      eligibility,
      constraintFailures: constraints.failures,
      dimensions: scoring.dimensions,
      explanation,
      // Ineligible jobs cannot rank above eligible ones on score alone.
      score: eligibility === "ineligible" ? Math.min(scoring.total, 25) : scoring.total
    },
    now
  );

  return { ok: true, evaluationId, eligibility, aiUsed };
}

function readPriorities(
  profile: ProfileContent
): Partial<Record<string, "higher" | "normal" | "lower">> {
  const p = (profile as Record<string, unknown>)["priorities"];
  return typeof p === "object" && p !== null
    ? (p as Partial<Record<string, "higher" | "normal" | "lower">>)
    : {};
}

export { getCurrentCompatibleEvaluation };
