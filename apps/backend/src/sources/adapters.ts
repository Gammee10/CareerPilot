// Source adapters (T4.1, ADR-011/059). Each adapter translates source schema
// into contract observations and captures provenance + restrictions.
import type { PoliteClient } from "./politeClient.js";
import { collectPages } from "./politeClient.js";
import type { SourceObservation } from "./contract.js";

export type AdapterContext = {
  client: PoliteClient;
  pageBudget: number;
  fetchedAt: string;
};

export type Adapter = {
  slug: "greenhouse" | "lever" | "remoteok";
  /** Collects observations for one target (board/site or whole feed). */
  collect(ctx: AdapterContext): Promise<{ observations: SourceObservation[]; pagesFetched: number }>;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Greenhouse — public Job Board API (see docs/dev/source-terms.md#greenhouse)
// ---------------------------------------------------------------------------
type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string | null };
  updated_at?: string;
  content?: string | null;
};

export function greenhouseAdapter(config: { boardToken: string }): Adapter {
  return {
    slug: "greenhouse",
    async collect({ client, pageBudget, fetchedAt }) {
      const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.boardToken)}/jobs`;
      const page = await collectPages<GreenhouseJob>(client, pageBudget, async () => {
        const { data } = await client.getJson<{ jobs?: GreenhouseJob[] }>(
          `${base}?content=true`
        );
        const items = data.jobs ?? [];
        // The list endpoint returns the full board; pagination budget still
        // bounds us if a paginated deployment is used later.
        return { items, hasMore: false };
      });

      return {
        pagesFetched: page.pagesFetched,
        observations: page.items.map((job): SourceObservation => ({
          source: "greenhouse",
          externalListingKey: String(job.id),
          companyName: config.boardToken,
          title: job.title,
          location: job.location?.name ?? null,
          descriptionText: job.content ? stripHtml(job.content) : null,
          applicationUrls: { preferred: job.absolute_url, alternatives: [] },
          postedAt: job.updated_at ?? null,
          availabilitySignal: "active",
          restrictions: [],
          provenance: { boardToken: config.boardToken, fetchedAt }
        }))
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Lever — public Postings API (see docs/dev/source-terms.md#lever)
// ---------------------------------------------------------------------------
type LeverPosting = {
  id: string;
  text: string;
  categories?: { location?: string | null; commitment?: string | null };
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
};

export function leverAdapter(config: { site: string }): Adapter {
  return {
    slug: "lever",
    async collect({ client, pageBudget, fetchedAt }) {
      const collected: SourceObservation[] = [];
      let pagesFetched = 0;

      const page = await collectPages<LeverPosting>(client, pageBudget, async (pageNo) => {
        const skip = (pageNo - 1) * 50;
        const url =
          `https://api.lever.co/v0/postings/${encodeURIComponent(config.site)}` +
          `?mode=json&skip=${skip}&limit=50`;
        const { data } = await client.getJson<LeverPosting[]>(url);
        pagesFetched += 0; // counted by outer wrapper below
        return { items: data ?? [], hasMore: (data ?? []).length === 50 };
      });
      void pagesFetched;

      for (const posting of page.items) {
        const preferred = posting.hostedUrl || posting.applyUrl;
        if (!preferred) continue;
        collected.push({
          source: "lever",
          externalListingKey: posting.id,
          companyName: config.site,
          title: posting.text,
          location: posting.categories?.location ?? null,
          descriptionText: null, // v0 postings API exposes no body text
          applicationUrls: { preferred, alternatives: [posting.applyUrl].filter((u): u is string => Boolean(u && u !== preferred)) },
          postedAt: typeof posting.createdAt === "number" ? new Date(posting.createdAt).toISOString() : null,
          availabilitySignal: "active",
          restrictions: [],
          provenance: { site: config.site, fetchedAt }
        });
      }
      return { observations: collected, pagesFetched: page.pagesFetched };
    }
  };
}

// ---------------------------------------------------------------------------
// RemoteOK — public feed with binding attribution conditions
// (see docs/dev/source-terms.md#remoteok)
// ---------------------------------------------------------------------------
type RemoteOkJob = Record<string, unknown> & {
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  url?: string;
  date?: string;
  description?: string;
};

const REMOTEOK_RESTRICTIONS = ["remoteok_attribution_direct_link", "remoteok_no_logo"];

export function remoteokAdapter(): Adapter {
  return {
    slug: "remoteok",
    async collect({ client, pageBudget, fetchedAt }) {
      void pageBudget; // single-document feed
      const { data } = await client.getJson<RemoteOkJob[]>("https://remoteok.com/api");

      const observations: SourceObservation[] = [];
      for (const entry of data.slice(1)) {
        // Element zero is RemoteOK's legal notice — never treated as a job.
        const key = typeof entry.slug === "string" ? entry.slug : String(entry.id ?? "");
        const listingUrl = typeof entry.url === "string" ? entry.url : "";
        if (!key || !listingUrl.startsWith("https://")) continue;
        observations.push({
          source: "remoteok",
          externalListingKey: key,
          companyName: typeof entry.company === "string" ? entry.company : "",
          title: typeof entry.position === "string" ? entry.position : "",
          location: typeof entry.location === "string" && entry.location.length > 0 ? entry.location : null,
          descriptionText:
            typeof entry.description === "string"
              ? stripHtml(entry.description).slice(0, 20_000)
              : null,
          // Direct link back to the Remote OK listing URL is a binding term.
          applicationUrls: { preferred: listingUrl, alternatives: [] },
          postedAt: typeof entry.date === "string" ? entry.date : null,
          availabilitySignal: "active",
          restrictions: [...REMOTEOK_RESTRICTIONS],
          provenance: { fetchedAt, legalNoticeAcknowledged: true }
        });
      }
      return { observations, pagesFetched: 1 };
    }
  };
}
