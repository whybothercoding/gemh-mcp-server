#!/usr/bin/env node
// Refreshes gemh-api-docs.json from the live ΓΕΜΗ Swagger UI.
//
// The spec isn't at a fixed path: the Swagger UI page returns a
// "Swagger-API-Docs-URL" response header pointing at it (root-relative),
// so we resolve that first instead of guessing /v3/api-docs or similar.
import { writeFile } from 'node:fs/promises';

const DOCS_HOST = 'https://opendata-api.businessportal.gr';
const DOCS_PAGE = `${DOCS_HOST}/opendata/docs/`;

const headRes = await fetch(DOCS_PAGE, { method: 'HEAD' });
const specPath = headRes.headers.get('swagger-api-docs-url');
if (!specPath) {
  throw new Error(`Could not find Swagger-API-Docs-URL header on ${DOCS_PAGE}`);
}

const specUrl = new URL(specPath, DOCS_HOST).toString();
const specRes = await fetch(specUrl);
if (!specRes.ok) {
  throw new Error(`Failed to fetch spec at ${specUrl}: HTTP ${specRes.status}`);
}

const spec = await specRes.json();
await writeFile(new URL('../gemh-api-docs.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n', 'utf8');
console.log(`Wrote gemh-api-docs.json from ${specUrl}`);
