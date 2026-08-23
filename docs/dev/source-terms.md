# Source API Terms Validation Records (T4.0 — ADR-059/033)

Blocking precondition: recorded **before** each adapter's first use.
Verified 2026-08-23 against live documentation. Re-validate on any known
terms change; adapters must be re-reviewed if restrictions change.

## Greenhouse

Verified against developers.greenhouse.io / grnhse job-board docs and
Greenhouse support "API overview".

- Public, unauthenticated, read-only Job Board API:
  `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs`
  (`content=true` includes full descriptions).
- No published numeric rate limit for reads; abusive polling is throttled.
  CareerPilot policy (~1 sustained req/s, per-board scheduled collection,
  bounded pages, Retry-After honored) is conservative relative to this.
- No attribution requirement documented for the read API.
- Application submission endpoints require authentication and are NOT used.

### Recorded obligations
- Per-board token scoping; no cross-board aggregation beyond separate calls.
- Respect informal throttle: max ~1 request/second, scheduled (daily /
  ≥6 h manual), bounded page budget.

## Lever

Verified against github.com/lever/postings-api (official).

- Public Postings API: `GET https://api.lever.co/v0/postings/{site}?mode=json`,
  pagination via `skip`/`limit`. HTTPS only. Official docs state published
  postings are publicly viewable and may be consumed by third parties.
- Documented rate limit (`429`, 2/s) applies to application POST requests,
  which CareerPilot does NOT use. Read limits are unpublished; our
  conservative ~1 req/s applies. Honor `Retry-After` on any 429.

### Recorded obligations
- JSON mode only; respect pagination caps; no application submissions.

## RemoteOK

Verified against remoteok.com/legal and the legal notice embedded as the
first element of the `https://remoteok.com/api` feed.

- Public JSON feed; delayed 24 hours by design; first array element is a
  legal notice, not a job (adapter must skip it).
- BINDING conditions from the embedded notice:
  - Mention "Remote OK" as the source wherever listings are displayed.
  - Link back with a DIRECT hyperlink to the listing URL on Remote OK
    (no redirects).
  - Do not use the Remote OK logo without written permission.
- Feed carries `salary_min`/`salary_max` numbers and ISO dates.

### Recorded obligations
- `remoteok_attribution_direct_link` restriction stored in every RemoteOK
  observation's provenance; display surfaces must render source attribution
  and a direct link to remoteok.com before beta launch (release-gate item).
