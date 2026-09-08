// L4 — file-secret contract: friendly operational errors, never raw ENOENT.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSecret, readSecretFile } from "../src/config.js";

describe("file-secret contract (L4)", () => {
  it("missing files fail with an operational message naming the file", () => {
    const missing = path.join(os.tmpdir(), `cp-missing-${Date.now()}.txt`);
    expect(() => readSecretFile(missing, "probe")).toThrow(/missing secret file/);
    try {
      readSecretFile(missing, "probe");
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(missing);
      expect(message).toContain("ADR-056");
      expect(message).not.toContain("ENOENT");
    }
  });

  it("empty files are rejected without leaking content", () => {
    const file = path.join(os.tmpdir(), `cp-empty-${Date.now()}.txt`);
    fs.writeFileSync(file, "  \n", "utf8");
    try {
      expect(() => readSecretFile(file)).toThrow(/empty secret file/);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("present secrets load trimmed", () => {
    const file = path.join(os.tmpdir(), `cp-secret-${Date.now()}.txt`);
    fs.writeFileSync(file, "  s3cret-value\n", "utf8");
    try {
      expect(readSecretFile(file)).toBe("s3cret-value");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("readSecret resolves names under the Compose secrets directory", () => {
    // /run/secrets does not exist outside containers — the point is the
    // operational error, not the value.
    expect(() => readSecret("definitely-not-a-secret")).toThrow(
      /missing secret file: \/run\/secrets\/definitely-not-a-secret/
    );
  });
});
