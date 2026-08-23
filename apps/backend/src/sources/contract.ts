// Shared source-listing observation contract (ADR-011). Adapters emit these;
// they never create canonical jobs or own cross-source decisions.
import { createHash } from "node:crypto";
export type SourceSlug = "greenhouse" | "lever" | "remoteok";

export type AvailabilitySignal = "active" | "closed" | "removed";

export type ApplicationLinks = {
  /** Employer ATS/career-site URL when the source provides one (ADR-007). */
  preferred?: string;
  alternatives: string[];
};

export type SourceObservation = {
  source: SourceSlug;
  externalListingKey: string;
  companyName: string;
  title: string;
  location: string | null;
  descriptionText: string | null;
  applicationUrls: ApplicationLinks;
  postedAt: string | null;
  availabilitySignal: AvailabilitySignal;
  /** Source-specific display/retention restrictions (e.g. RemoteOK attribution). */
  restrictions: string[];
  /** Raw permitted source fields + fetch metadata; persisted as provenance jsonb. */
  provenance: Record<string, unknown>;
};

const URL_RE = /^https:\/\/\S+$/;

// Normalization-stage validation (T4.2 / ADR-012): adapter output is treated
// as untrusted input and must satisfy the common representation exactly.
export function validateSourceObservation(raw: unknown):
  | { ok: true; observation: SourceObservation }
  | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reasons: ["not_an_object"] };
  }
  const o = raw as Record<string, unknown>;

  if (!["greenhouse", "lever", "remoteok"].includes(String(o.source))) {
    reasons.push("invalid_source");
  }
  if (typeof o.externalListingKey !== "string" || o.externalListingKey.length === 0 ||
      o.externalListingKey.length > 200) {
    reasons.push("invalid_external_listing_key");
  }
  if (typeof o.companyName !== "string" || o.companyName.trim().length === 0) {
    reasons.push("invalid_company_name");
  }
  if (typeof o.title !== "string" || o.title.trim().length === 0 || o.title.length > 300) {
    reasons.push("invalid_title");
  }
  if (o.location !== null && typeof o.location !== "string") {
    reasons.push("invalid_location");
  }
  if (o.descriptionText !== null && typeof o.descriptionText !== "string") {
    reasons.push("invalid_description");
  }

  const urls = o.applicationUrls as { preferred?: unknown; alternatives?: unknown } | undefined;
  const preferred = urls?.preferred;
  const alternatives = urls?.alternatives;
  if (preferred !== undefined && !(typeof preferred === "string" && URL_RE.test(preferred))) {
    reasons.push("_invalid_preferred_url");
  }
  if (
    !Array.isArray(alternatives) ||
    alternatives.some((u) => typeof u !== "string" || !URL_RE.test(u))
  ) {
    reasons.push("invalid_alternative_urls");
  }
  if ((preferred === undefined || preferred === "") &&
      (!Array.isArray(alternatives) || alternatives.length === 0)) {
    reasons.push("no_application_urls");
  }
  if (!["active", "closed", "removed"].includes(String(o.availabilitySignal))) {
    reasons.push("invalid_availability_signal");
  }
  if (!Array.isArray(o.restrictions) || o.restrictions.some((r) => typeof r !== "string")) {
    reasons.push("invalid_restrictions");
  }
  if (typeof o.provenance !== "object" || o.provenance === null) {
    reasons.push("invalid_provenance");
  }
  if (o.postedAt !== null && o.postedAt !== undefined && typeof o.postedAt !== "string") {
    reasons.push("invalid_posted_at");
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    observation: raw as unknown as SourceObservation
  };
}

/** Deterministic hash over material fields only (ADR-039 classification input). */
export function materialFingerprint(o: {
  title: string;
  location: string | null;
  descriptionText: string | null;
  applicationUrls: ApplicationLinks;
}): string {
  const canonical = JSON.stringify([
    o.title.trim(),
    o.location?.trim() ?? null,
    o.descriptionText ?? null,
    [o.applicationUrls.preferred ?? null, [...o.applicationUrls.alternatives].sort()]
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
