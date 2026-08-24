// Named dimension scoring with transparent penalties (T6.2, FR-19/21/22).
// Pure + deterministic. User priorities are simple higher/lower controls
// (FR-22); hard constraints never enter the score (they gate eligibility).

export type Priority = "higher" | "normal" | "lower";

export const DIMENSION_NAMES = [
  "role_match",
  "skill_match",
  "experience_match",
  "location_eligibility",
  "salary_match"
] as const;

export type DimensionName = (typeof DIMENSION_NAMES)[number];

const BASE_WEIGHTS: Record<DimensionName, number> = {
  role_match: 0.25,
  skill_match: 0.25,
  experience_match: 0.2,
  location_eligibility: 0.15,
  salary_match: 0.15
};

const PRIORITY_FACTOR: Record<Priority, number> = { higher: 1.25, normal: 1, lower: 0.75 };

/** Maps user-facing priority keys onto dimensions (FR-22). */
const PRIORITY_KEY_MAP: Record<string, DimensionName> = {
  role_fit: "role_match",
  salary: "salary_match",
  skills: "skill_match",
  remote: "location_eligibility"
};

export function resolveWeights(priorities: Partial<Record<string, Priority>> = {}): Record<DimensionName, number> {
  const weights = { ...BASE_WEIGHTS };
  for (const [key, priority] of Object.entries(priorities)) {
    const dim = PRIORITY_KEY_MAP[key];
    if (dim && priority && ["higher", "normal", "lower"].includes(priority)) {
      weights[dim] *= PRIORITY_FACTOR[priority];
    }
  }
  // Normalize to sum 1.
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const name of DIMENSION_NAMES) {
    weights[name] = weights[name] / sum;
  }
  return weights;
}

export type Penalty = { reason: string; delta: number };

export type ScoredDimension = {
  name: DimensionName;
  weight: number;
  raw: number;          // 0..1 before penalties
  score: number;        // weighted contribution after penalties
  penalties: Penalty[];
};

export type ScoreInput = {
  constraintStatus: "eligible" | "unverified" | "ineligible";
  unknownConstraints: Array<{ constraint: string; detail: string }>;
  title: string | null;
  targetRole: string | null;
  profileSkills: string[];
  descriptionText: string | null;
  remoteInferred: boolean | null;
  remoteOnlyPreferred: boolean;
  salaryDisclosed: boolean;
  priorities?: Partial<Record<string, Priority>>;
};

export type ScoreResult = {
  total: number;                       // 0..100
  dimensions: ScoredDimension[];
  penaltiesApplied: Penalty[];         // flat, transparent list (FR-21)
};

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 2)
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0.5; // neutral when incomparable
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return Math.min(1, hits / a.size);
}

export function scoreJob(input: ScoreInput): ScoreResult {
  const UNKNOWN_PENALTY = 8; // transparent fixed penalty per unknown dimension
  const weights = resolveWeights(input.priorities);

  const roleTokens = input.targetRole ? tokens(input.targetRole) : new Set<string>();
  const titleTokens = input.title ? tokens(input.title) : new Set<string>();
  const skillSet = new Set(input.profileSkills.map((s) => s.toLowerCase()));
  const descTokens = input.descriptionText ? tokens(input.descriptionText) : new Set<string>();

  const penaltiesByDim: Record<DimensionName, Penalty[]> = {
    role_match: [],
    skill_match: [],
    experience_match: [],
    location_eligibility: [],
    salary_match: []
  };

  // Deterministic raw scores in 0..1.
  const roleRaw = roleTokens.size === 0 ? 0.5 : overlapRatio(roleTokens, titleTokens);
  const skillRaw =
    skillSet.size === 0 || descTokens.size === 0 ? 0.5 : overlapRatio(skillSet, descTokens);
  const experienceRaw = 0.5; // no structured experience requirement exists yet

  let locationRaw: number;
  if (input.constraintStatus === "ineligible") {
    locationRaw = 0;
  } else if (input.remoteInferred === true) {
    locationRaw = 1;
  } else if (input.remoteOnlyPreferred && input.remoteInferred === null) {
    locationRaw = 0.5;
    penaltiesByDim.location_eligibility.push({
      reason: "unverified_remote_eligibility",
      delta: UNKNOWN_PENALTY
    });
  } else {
    locationRaw = 0.5;
  }

  const salaryRaw = 0.5;
  if (!input.salaryDisclosed) {
    // Transparent penalty whenever salary information is unavailable (FR-21).
    penaltiesByDim.salary_match.push({
      reason: "no_disclosed_salary",
      delta: UNKNOWN_PENALTY
    });
  }

  // Constraint unknowns add labeled penalties to the most-related dimension.
  for (const u of input.unknownConstraints) {
    if (u.constraint === "salary_floor") continue; // already penalized above
    penaltiesByDim.location_eligibility.push({
      reason: `unknown_${u.constraint}`,
      delta: UNKNOWN_PENALTY
    });
  }

  const dims: ScoredDimension[] = [];
  const raws: Record<DimensionName, number> = {
    role_match: roleRaw,
    skill_match: skillRaw,
    experience_match: experienceRaw,
    location_eligibility: locationRaw,
    salary_match: salaryRaw
  };
  let total = 0;
  for (const name of DIMENSION_NAMES) {
    const penaltyTotal = penaltiesByDim[name].reduce((a, p) => a + p.delta, 0);
    const score = Math.max(0, weights[name] * raws[name] * 100 - penaltyTotal * weights[name]);
    total += score;
    dims.push({ name, weight: weights[name], raw: raws[name], score, penalties: penaltiesByDim[name] });
  }

  const penaltiesApplied = DIMENSION_NAMES.flatMap((n) => penaltiesByDim[n]);
  total = Math.round(total * 10) / 10;
  // A hard-constraint failure caps the score: it can never outrank an
  // eligible result regardless of dimension strengths (FR-21).
  if (input.constraintStatus === "ineligible") total = Math.min(total, 25);
  return { total, dimensions: dims, penaltiesApplied };
}
