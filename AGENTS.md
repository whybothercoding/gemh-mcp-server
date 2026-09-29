# Repository context

Node.js/TypeScript read-only stdio MCP server for the ΓΕΜΗ Open Data API.

## Code map

- `src/index.ts`: environment validation and stdio entry point.
- `src/server.ts`: tool schemas and dispatch; `src/gemhClient.ts`: upstream HTTP, rate limiting, and response handling.
- `src/activities.ts`, `src/metadata.ts`, `src/companies.ts`: tool logic.
- `src/cache.ts`, `src/text.ts`, `src/rateLimiter.ts`: shared helpers.

## Working rules

- Keep registry HTTP requests in `GemhClient`; preserve bounded streaming for downloads.
- Reserve stdout for MCP protocol messages. Send diagnostics to stderr.
- The embedded API spec can differ from live behavior. Verify the live API when changing upstream response handling.
- Done: `npm run build && npm run tools:list` passes. Smoke-check changed API paths when an API key is available.
