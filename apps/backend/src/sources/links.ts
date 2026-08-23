// Application-link selection (T4.6 / ADR-007): employer ATS/career-site link
// preferred when available; alternatives retained for the detail view.
import type { ApplicationLinks } from "./contract.js";

export type SelectedLinks = {
  preferred: string;
  alternatives: string[];
  basis: "employer_ats" | "source_link";
};

export function selectApplicationLinks(links: ApplicationLinks): SelectedLinks {
  const alternatives = [...links.alternatives];
  if (links.preferred) {
    return {
      preferred: links.preferred,
      alternatives: alternatives.filter((u) => u !== links.preferred),
      // The caller decides semantics; here "preferred" from the source is the
      // employer ATS URL when the source provides one (Greenhouse/Lever do).
      basis: "employer_ats"
    };
  }
  const fallback = alternatives.shift();
  if (!fallback) throw new Error("no_application_links");
  return { preferred: fallback, alternatives, basis: "source_link" };
}
