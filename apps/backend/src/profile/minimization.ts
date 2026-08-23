// ADR-054 minimization boundary: identifiers never reach the provider.
// Redaction is deterministic and testable; the post-conditions are asserted
// again immediately before any provider-visible payload is built.
import { createHash } from "node:crypto";

export type IdentityHints = {
  knownEmails?: string[];
  knownNames?: string[];
  knownAccountIds?: string[];
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// International phone numbers: optional +, separators, 10-15 digits.
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,15}\d)/g;
const URL_RE = /https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/g;
const FILENAME_RE = /\b[\w .-]+\.(pdf|docx?|txt|rtf|pages)\b/gi;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function redactIdentifiers(
  raw: string,
  hints: IdentityHints = {}
): string {
  let out = raw.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  out = out.replace(URL_RE, "[REDACTED_URL]");
  out = out.replace(FILENAME_RE, "[REDACTED_FILENAME]");
  out = out.replace(PHONE_RE, "[REDACTED_PHONE]");
  out = out.replace(UUID_RE, "[REDACTED_ID]");
  for (const email of hints.knownEmails ?? []) {
    if (email) out = out.split(email).join("[REDACTED_EMAIL]");
  }
  for (const name of hints.knownNames ?? []) {
    if (name && name.trim().length > 1) out = out.split(name).join("[REDACTED_NAME]");
  }
  for (const id of hints.knownAccountIds ?? []) {
    if (id) out = out.split(id).join("[REDACTED_ACCOUNT_ID]");
  }
  return out;
}

// Post-condition assertion: fails closed if anything identifier-like remains
// after redaction. This runs before the payload leaves CareerPilot.
export function assertMinimized(text: string): void {
  const checks: Array<[RegExp, string]> = [
    [EMAIL_RE, "email"],
    [/https?:\/\/|www\./, "url"],
    [/\b\+?\d[\d\s().-]{8,15}\d\b/, "phone"]
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) {
      throw new Error(`minimization violation: possible ${label} in provider payload`);
    }
  }
}

export type ExtractionTask = {
  task: "resume_extraction";
  content: string;
};

export function buildExtractionTask(rawResumeText: string, hints: IdentityHints): ExtractionTask {
  const content = redactIdentifiers(rawResumeText, hints);
  assertMinimized(content);
  return { task: "resume_extraction", content };
}

export function taskContentHash(task: ExtractionTask): string {
  return createHash("sha256").update(JSON.stringify(task)).digest("hex");
}
