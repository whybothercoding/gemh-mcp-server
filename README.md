# ΓΕΜΗ Open Data MCP Server

A read-only [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
server for the [ΓΕΜΗ Open Data API](https://opendata.businessportal.gr/), the
Greek General Commercial Registry. It lets an MCP client search public company
records, retrieve company documents, and look up registry reference data.

This is an independent software project. It is not affiliated with or endorsed
by ΓΕΜΗ, the Central Union of Chambers of Greece (ΚΕΕΕ/UHCCI), or the Greek
government.

## What it provides

All tools are read-only. Company searches are paginated, and return a compact
projection by default to keep large registry records manageable. Use
`fullDetails: true` on a search, or `gemh_get_company`, when the full public
record is needed.

| Tool | Purpose |
|---|---|
| `gemh_search_companies` | Search by registry number, tax number, name, ΚΑΔ activity, region, legal type, status, or ΓΕΜΗ office. |
| `gemh_get_company` | Retrieve one company’s public record by ΓΕΜΗ number. |
| `gemh_get_company_documents` | Retrieve public decisions and announcements for a company. |
| `gemh_download_file` | Download a document by the `key` and `elementId` in its URL. Files up to 3 MiB are returned as base64; larger files return metadata. |
| `gemh_search_activities` | Search Greek and English ΚΑΔ descriptions by keyword, including both `kad_2008` and `kad_2026` classifications. |
| `gemh_get_prefectures` | List or filter prefectures. |
| `gemh_get_municipalities` | List or filter municipalities, optionally by prefecture. |
| `gemh_get_company_statuses` | List or filter company statuses. |
| `gemh_get_legal_types` | List or filter legal types. |
| `gemh_get_gemi_offices` | List or filter ΓΕΜΗ offices. |
| `gemh_get_assembly_subjects` | List or filter assembly decision subjects. |
| `gemh_health_check` | Call the API health endpoint. A successful response may have an empty body and appear as `null`. |

Search filters are combined with AND; multiple values in an array filter are
combined with OR. Search pages contain up to 200 records. Add a filter when
possible: an unfiltered search can scan the full registry.

## Data, accuracy, and responsible use

The server relays public registry data from ΓΕΜΗ; it does not verify or enrich
that data. Records can be incomplete or out of date, and absence of a field
should not be treated as proof that the information does not exist. Check the
official registry before relying on a result for a consequential decision.

Registry records and documents may contain information about identifiable
people. Public availability does not remove obligations that apply to your
collection, storage, use, or sharing of that information. Use the API only for
lawful purposes and follow the [ΓΕΜΗ Open Data terms](https://opendata.businessportal.gr/license/).
The upstream API and data are published under ODC-BY 1.0; provide attribution
as required by those terms.

The upstream API requires an approved personal API key. Request access through
the [official registration page](https://opendata.businessportal.gr/register/)
and read the [official technical documentation](https://opendata.businessportal.gr/techdocs/).
Do not commit or share your key. This server reads it from its process
environment and sends it in the `api_key` header. If you override
`GEMH_BASE_URL`, use only a trusted endpoint: the key will be sent to that host.

## Requirements

- Node.js and npm
- An approved ΓΕΜΗ Open Data API key
- An MCP host that can launch a local stdio server

## Install and run

```bash
# From the project directory
npm install
npm run build
```

Set `GEMH_API_KEY` in the environment used to launch the server, then run:

```bash
npm start
```

The process communicates over standard input and output using MCP stdio. Do not
run other programs that write to its standard output in the same process.

### Codex configuration example

Build the project first. Make sure `GEMH_API_KEY` is available in the
environment from which Codex starts, then add this to `~/.codex/config.toml`:

```toml
[mcp_servers.GEMH]
enabled = true
command = "node"
args = ["/absolute/path/to/gemh-mcp-server/dist/index.js"]
env_vars = ["GEMH_API_KEY"]
```

`env_vars` passes through the existing environment variable; it does not set
the key. Other MCP hosts have their own configuration format, but must launch
the compiled `dist/index.js` process and provide `GEMH_API_KEY`.

## Configuration

| Variable | Required | Description |
|---|---:|---|
| `GEMH_API_KEY` | Yes | Approved API key. Sent as the `api_key` header on every request. |
| `GEMH_BASE_URL` | No | API base URL override. Defaults to `https://opendata-api.businessportal.gr/api/opendata/v1`. |
| `GEMH_MAX_REQUESTS_PER_MINUTE` | No | Client-side request pacing. Defaults to 8 and must be a positive integer. Raising it does not raise the quota enforced by ΓΕΜΗ. |

The default pacing value reflects this project’s confirmed integration limit;
the upstream service controls its own quota, which may differ by key or change.
Requests beyond the configured client-side rate wait in a queue.

## Caching and response behavior

- Reference lists are cached locally in `~/.cache/gemh-mcp-server/`: 24 hours
  for the smaller lists and 7 days for the larger ΚΑΔ activity list. Company
  searches, company records, documents, and downloads are requested live.
- A company search that matches no records may receive an upstream HTTP 404;
  this server returns an empty result set for that case.
- Search results are compact by default. They deduplicate and cap activity
  entries and include only a short objective excerpt. `fullDetails: true`
  returns untrimmed search records; `gemh_get_company` returns the full record.
- Documents up to 3 MiB are included in the tool response as base64. Larger
  files are not buffered into the response; the tool returns metadata instead.

## Development

```bash
npm run build
npm run typecheck
npm run tools:list
```

There is no automated test suite. Live API checks require a valid key and are
subject to ΓΕΜΗ’s access and rate limits. To refresh the embedded Swagger
specification exposed as the `gemh://docs/openapi` MCP resource, run:

```bash
npm run fetch:spec
```

## License

The upstream ΓΕΜΗ API and data are published under [ODC-BY 1.0](https://opendata.businessportal.gr/license/).
That license does not apply to this server’s source code. The package currently
marks the code as `UNLICENSED`; this repository grants no license to use,
modify, or redistribute the code.
