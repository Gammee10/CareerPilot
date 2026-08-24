// Strict Node-side validation of AI proposals (ADR-054). The proposal is an
// untrusted suggestion: anything that does not exactly match the expected
// structure is rejected and nothing is persisted.
export type EmploymentEntry = {
  title: string;
  company: string;
  startDate: string;
  endDate: string | null;
};

export type EducationEntry = {
  degree: string;
  institution: string;
  year: number;
};

export type ProfileProposal = {
  summary?: string;
  skills: string[];
  employment: EmploymentEntry[];
  education: EducationEntry[];
  certifications: string[];
};

const DATE_RE = /^\d{4}(-\d{2})?(-\d{2})?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown, maxItems: number): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= maxItems &&
    v.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= 200)
  );
}

export function validateProposal(raw: unknown):
  | { ok: true; proposal: ProfileProposal }
  | { ok: false; reason: string } {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_an_object" };

  const { summary, skills, employment, education, certifications } = raw;

  // Reject unknown top-level fields outright.
  const allowed = new Set(["summary", "skills", "employment", "education", "certifications"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { ok: false, reason: `unknown_field:${key}` };
  }

  if (summary !== undefined && (typeof summary !== "string" || summary.length > 1000)) {
    return { ok: false, reason: "invalid_summary" };
  }
  if (!isStringArray(skills, 60)) return { ok: false, reason: "invalid_skills" };
  if (!isStringArray(certifications ?? [], 30)) {
    return { ok: false, reason: "invalid_certifications" };
  }

  if (!Array.isArray(employment) || employment.length > 25) {
    return { ok: false, reason: "invalid_employment" };
  }
  const EMPLOYMENT_KEYS = ["title", "company", "startDate", "endDate"];
  for (const e of employment) {
    if (!isPlainObject(e)) return { ok: false, reason: "invalid_employment_entry" };
    // Exact key whitelist: injected extra fields (workflow tampering, T9.2)
    // are rejected rather than silently ignored.
    for (const key of Object.keys(e)) {
      if (!EMPLOYMENT_KEYS.includes(key)) {
        return { ok: false, reason: `unknown_employment_field:${key}` };
      }
    }
    if (
      typeof e.title !== "string" ||
      typeof e.company !== "string" ||
      typeof e.startDate !== "string" ||
      !DATE_RE.test(e.startDate) ||
      !(e.endDate === null || (typeof e.endDate === "string" && DATE_RE.test(e.endDate)))
    ) {
      return { ok: false, reason: "invalid_employment_entry" };
    }
  }

  if (!Array.isArray(education) || education.length > 15) {
    return { ok: false, reason: "invalid_education" };
  }
  const EDUCATION_KEYS = ["degree", "institution", "year"];
  for (const e of education) {
    if (!isPlainObject(e)) return { ok: false, reason: "invalid_education_entry" };
    for (const key of Object.keys(e)) {
      if (!EDUCATION_KEYS.includes(key)) {
        return { ok: false, reason: `unknown_education_field:${key}` };
      }
    }
    if (
      typeof e.degree !== "string" ||
      typeof e.institution !== "string" ||
      typeof e.year !== "number" ||
      !Number.isInteger(e.year) ||
      e.year < 1950 ||
      e.year > 2100
    ) {
      return { ok: false, reason: "invalid_education_entry" };
    }
  }

  return {
    ok: true,
    proposal: {
      ...(summary !== undefined ? { summary } : {}),
      skills,
      employment: employment as EmploymentEntry[],
      education: education as EducationEntry[],
      certifications: (certifications ?? []) as string[]
    }
  };
}
