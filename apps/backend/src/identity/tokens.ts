import { randomBytes, createHash } from "node:crypto";

// Opaque, unguessable tokens (ADR-018). Only the SHA-256 hash is persisted;
// the raw token exists solely in the delivered link and in memory.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
