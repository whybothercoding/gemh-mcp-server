# ΓΕΜΗ MCP Server (Node.js)

A **Model Context Protocol (MCP)** server that exposes the Greek Business Registry
(ΓΕΜΗ) Open Data API — company search, company records/documents, and the
reference lists (ΚΑΔ activities, prefectures, municipalities, legal types,
statuses, ΓΕΜΗ offices, assembly subjects) needed to drive that search.

Built primarily for **prospecting**: finding companies in a given activity
category (ΚΑΔ) and/or region as candidate leads.

## Tools

- `gemh_search_companies` — search companies by ΚΑΔ activity, prefecture,
  municipality, legal type, status, name, ΑΦΜ, or ΓΕΜΗ number (AND across
  filters, OR within each array filter). Paginated, max 200 results/page.
- `gemh_get_company` — full public record for one company by ΓΕΜΗ number.
- `gemh_get_company_documents` — a company's public ΓΕΜΗ documents (decisions,
  announcements).
- `gemh_search_activities` — keyword search over the ~19k-row ΚΑΔ activity
  classification (cached locally), accent/case-insensitive, Greek + English.
  **Start here** to turn "businesses that do X" into activity ids for
  `gemh_search_companies`.
- `gemh_get_prefectures` / `gemh_get_municipalities` / `gemh_get_legal_types` /
  `gemh_get_company_statuses` / `gemh_get_gemi_offices` /
  `gemh_get_assembly_subjects` — small cached reference lists, each with an
  optional keyword filter.
- `gemh_download_file` — fetch one document by key/elementId (inlined as
  base64 under ~3MB, otherwise metadata + a pointer to fetch it directly).
- `gemh_health_check` — API status.

## Configuration

- `GEMH_API_KEY` (required): personal production key from the ΓΕΜΗ Open Data
  access request process. Sent as the `api_key` header on every request.
- `GEMH_BASE_URL` (optional): override the default
  `https://opendata-api.businessportal.gr/api/opendata/v1`.
- `GEMH_MAX_REQUESTS_PER_MINUTE` (optional): override the default of 8 — the
  confirmed production rate limit for this API key.

## Key API quirks (why the code looks the way it does)

- **8 requests/minute, hard limit.** Enforced client-side by `RateLimiter`
  (`src/rateLimiter.ts`), wrapping every HTTP call in `GemhClient` — callers
  are paced (queued), not rejected, so a burst of tool calls (metadata
  lookups, an activities search, a company search, ...) in one prospecting
  session just takes longer rather than 429ing. Paging through a large
  `searchMetadata.totalCount` will be slow by design.
- **404 means "zero matches" on search, not an error.** `GET /companies` with
  filters that match nothing returns HTTP 404 rather than a 200 with an empty
  array. `gemh_search_companies` normalizes this to a proper empty result;
  `gemh_get_company`/`gemh_get_company_documents` (single-record lookups)
  still treat 404 as "not found."
- **Raw company records can be huge.** `objective` is often several KB of
  legal boilerplate, and long-lived companies can carry 90+ secondary ΚΑΔ
  activities (with duplicates across the kad_2008/kad_2026 transition) plus
  full board-member and capital/stock detail — 5 raw records measured at
  224k+ characters, over typical MCP tool-result limits. `gemh_search_companies`
  returns a compact per-company projection by default (deduped/capped
  activities, a short objective excerpt); pass `fullDetails: true` for the
  raw record, or use `gemh_get_company` for a single company.
- **400s come back as HTML, not the documented `ErrorEntry[]` JSON** — the
  upstream `swagger-tools` validator renders a stack-trace page. The client
  extracts the first readable line out of the `<pre>` block.
- **ΚΑΔ is mid-migration**: both `kad_2008` and `kad_2026` codes appear in the
  activities list and in live company records as of late 2026.
  `gemh_search_activities` searches both by default.
- Reference lists are cached to `~/.cache/gemh-mcp-server/*.json` (1 day TTL;
  7 days for the large activities list) per the API's own guidance that this
  parametric data "doesn't change frequently."

## Installation

```bash
npm install
npm run build
```

## Running

```bash
export GEMH_API_KEY='your_api_key'
npm start
```

For development: `npm run dev`

## Verification

```bash
npm run build && npm run tools:list
```

## Maintenance

To refresh the embedded spec resource (`gemh-api-docs.json`, exposed as the
`gemh://docs/openapi` MCP resource) from the live Swagger UI:

```bash
npm run fetch:spec
```

## License
UNLICENSED
