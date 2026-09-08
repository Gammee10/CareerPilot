// H14: application URLs arrive from untrusted source listings. Only
// https: links are ever rendered clickable; anything else (javascript:,
// data:, http:, unparseable) is rendered as inert text by the caller.
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
}
