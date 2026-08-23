// Artifact storage boundary (ADR-050): private, S3-compatible object store.
// Production uses the S3-compatible API (OCI Object Storage); local dev and
// tests use an in-memory driver behind the same interface. Objects are never
// publicly reachable — access happens only through short-lived scoped grants
// mediated by the backend (T3.1).

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export class InMemoryObjectStore implements ObjectStore {
  private objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const hit = this.objects.get(key);
    return hit ? { body: Buffer.from(hit.body), contentType: hit.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export function buildObjectStore(): ObjectStore {
  const driver = process.env.OBJECT_STORE_DRIVER ?? "inmemory";
  if (driver === "inmemory") return new InMemoryObjectStore();
  // The S3-compatible production driver is wired during operations hardening
  // (Phase 8 backup/artifact work) with credentials from file-mounted secrets.
  throw new Error(`unsupported OBJECT_STORE_DRIVER: ${driver}`);
}
