// Deterministic hard-constraint engine (T6.1, FR-4/6/7, ADR-002).
// PURE function over structured profile settings + structured job facts.
// Description text is NOT an input — adversarial job claims cannot flip a
// deterministic rejection (T6.1 AC). AI output never reaches this module.

export type SettingClassification = "hard_constraint" | "preference";

export type ProfileSetting = {
  value: unknown;
  classification: SettingClassification;
  strict?: boolean;
};

export type ConstraintFailure = { constraint: string; detail: string };
export type ConstraintUnknown = { constraint: string; detail: string };

export type ConstraintResult = {
  status: "eligible" | "unverified" | "ineligible";
  failures: ConstraintFailure[];
  unknowns: ConstraintUnknown[];
};

// Same strict prefix rule as jobFacts.inferRemote — free text containing the
// word "remote" (e.g. injected instructions) must not satisfy location scope.
const REMOTE_PREFIX_RE =
  /^\s*(fully remote|100% remote|remote|distributed|work from anywhere)\b/i;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Evaluates the user's hard_constraint settings against structured facts.
 * FR-6: reject only on CLEAR contradiction of location/residence/work-auth.
 * FR-7: salary floor rejects only a clearly-lower DISCLOSED salary; no
 * disclosed salary stays visible and is labeled unknown.
 */
export function evaluateHardConstraints(
  settings: Record<string, ProfileSetting>,
  facts: {
    company: string | null;
    title: string | null;
    location: string | null;
    remoteInferred: boolean | null;
    salaryMin: number | null;
  }
): ConstraintResult {
  const failures: ConstraintFailure[] = [];
  const unknowns: ConstraintUnknown[] = [];

  for (const [name, setting] of Object.entries(settings)) {
    if (setting.classification !== "hard_constraint") continue;

    switch (name) {
      case "remote_only": {
        if (setting.value !== true) break;
        if (facts.remoteInferred === true) break; // satisfied
        if (facts.remoteInferred === false && facts.location !== null) {
          failures.push({
            constraint: name,
            detail: `job location "${facts.location}" contradicts remote-only requirement`
          });
        } else {
          unknowns.push({
            constraint: name,
            detail: "job does not disclose whether remote work is possible"
          });
        }
        break;
      }

      case "locations": {
        const allowed = asStringArray(setting.value);
        if (allowed.length === 0) break;
        if (facts.location === null) {
          unknowns.push({ constraint: name, detail: "job discloses no location" });
          break;
        }
        const match = allowed.some(
          (a) =>
            facts.location!.toLowerCase().includes(a.toLowerCase()) ||
            REMOTE_PREFIX_RE.test(facts.location!) // explicit remote satisfies any location scope
        );
        if (!match) {
          failures.push({
            constraint: name,
            detail: `job location "${facts.location}" is outside allowed locations`
          });
        }
        break;
      }

      case "excluded_companies": {
        const excluded = asStringArray(setting.value).map((c) => c.toLowerCase());
        if (excluded.length === 0 || !facts.company) break;
        if (excluded.includes(facts.company.toLowerCase())) {
          failures.push({
            constraint: name,
            detail: `employer "${facts.company}" is excluded by profile`
          });
        }
        break;
      }

      case "salary_floor": {
        const floor = Number(setting.value);
        if (!Number.isFinite(floor)) break;
        if (facts.salaryMin === null) {
          // FR-7: undisclosed salary remains visible, labeled unknown.
          unknowns.push({
            constraint: name,
            detail: "no disclosed salary to compare against minimum"
          });
        } else if (facts.salaryMin < floor) {
          failures.push({
            constraint: name,
            detail: `disclosed salary ${facts.salaryMin} is below minimum ${floor}`
          });
        }
        break;
      }

      default:
        // Unknown hard-constraint names cannot be evaluated → truthful unknown.
        unknowns.push({ constraint: name, detail: "constraint cannot be evaluated from available structured fields" });
    }
  }

  const status =
    failures.length > 0 ? "ineligible" : unknowns.length > 0 ? "unverified" : "eligible";
  return { status, failures, unknowns };
}
