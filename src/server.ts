import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GemhClient } from './gemhClient.js';
import { searchActivities } from './activities.js';
import { hasAnyContactInfo, isShellRecord, toCompactCompany } from './companies.js';
import {
  getAssemblySubjects,
  getCompanyStatuses,
  getGemiOffices,
  getLegalTypes,
  getMunicipalities,
  getPrefectures,
} from './metadata.js';

export type CreateServerOptions = {
  apiKey: string;
  baseUrl?: string;
  maxRequestsPerMinute?: number;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  handler: (client: GemhClient, args: Record<string, unknown>) => Promise<unknown>;
};

// Every tool here is a read-only query against the live ΓΕΜΗ API or a
// disk-cached mirror of it — no mutating endpoints exist. Shared so each of
// the TOOLS entries below can spread it in rather than repeating the block.
const READONLY_EXTERNAL: Record<string, unknown> = { readOnlyHint: true, openWorldHint: true };

// Max bytes of a downloadFile payload we'll inline as base64 in a tool response.
// GEMH documents are mostly small PDFs (statutes, ΓΕΜΗ announcements); anything
// bigger is more useful fetched directly than dumped into the conversation.
const MAX_DOWNLOAD_BYTES = 3 * 1024 * 1024;

const TOOLS: ToolDefinition[] = [
  {
    name: 'gemh_search_companies',
    annotations: { title: 'gemh_search_companies', ...READONLY_EXTERNAL },
    description:
      'Search ΓΕΜΗ (Greek Business Registry) companies by criteria — the main tool for finding businesses of a given ' +
      'category (ΚΑΔ activity), region, legal form, or status. At least one filter is recommended (an unfiltered call ' +
      'walks the entire ~1.7M-company registry). Use gemh_search_activities first to resolve activity keywords to ΚΑΔ ' +
      'ids, and gemh_get_prefectures/gemh_get_municipalities/gemh_get_legal_types/gemh_get_company_statuses to resolve ' +
      'the other id-based filters. Multiple filters are ANDed together. Results are trimmed by default (name, address, ' +
      'contact, activities, a short objective excerpt) to keep bulk scans compact — pass fullDetails:true for the raw ' +
      'record (full objective text, board members, capital/stock structure), or use gemh_get_company for a single company. ' +
      'For an enrichment queue (find companies still missing contact info, worth an Outscraper pass): filter ' +
      'isActive:true, leave requireContactInfo unset, drop rows with phone/email/url populated client-side, and pass ' +
      'prioritizeCompleteRecords:true to surface the higher-hit-rate candidates first — isActive alone barely predicts ' +
      'findability (verified: active and inactive companies have nearly identical no-contact rates, ~26-30%). ' +
      'Note: the underlying API is capped at 8 requests/minute, enforced automatically by this server — paging through a ' +
      'large totalCount (e.g. via resultsOffset) is paced accordingly and will take real wall-clock time, not fail.',
    inputSchema: {
      type: 'object',
      properties: {
        arGemi: { type: 'string', description: 'Exact ΓΕΜΗ registry number.' },
        afm: {
          type: 'string',
          minLength: 9,
          maxLength: 9,
          description: 'Exact ΑΦΜ (tax id), zero-padded to 9 digits.',
        },
        name: {
          type: 'string',
          minLength: 3,
          description: 'Keyword matched against both the company name (επωνυμία) and trade title (διακριτικός τίτλος).',
        },
        activities: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more ΚΑΔ activity ids (from gemh_search_activities). ANDed with other filters, ORed within this list.',
        },
        prefectures: {
          type: 'array',
          items: { type: 'integer' },
          description: 'One or more prefecture (νομός) ids (from gemh_get_prefectures).',
        },
        municipalities: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more municipality (δήμος) ids (from gemh_get_municipalities).',
        },
        legalTypes: {
          type: 'array',
          items: { type: 'integer' },
          description: 'One or more legal form ids (from gemh_get_legal_types), e.g. ΑΕ, ΕΠΕ, ΙΚΕ.',
        },
        gemiOffices: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more local ΓΕΜΗ office / chamber ids (from gemh_get_gemi_offices).',
        },
        statuses: {
          type: 'array',
          items: { type: 'integer' },
          description: 'One or more company status ids (from gemh_get_company_statuses).',
        },
        isActive: { type: 'boolean', description: 'Restrict to active (true) or inactive (false) companies.' },
        resultsSortBy: {
          type: 'string',
          enum: ['+coName', '-coName', '+afm', '-afm', '+arGemi', '-arGemi', '+incorporationDate', '-incorporationDate'],
          description: 'Sort field; + ascending, - descending. Defaults to +arGemi.',
        },
        resultsOffset: { type: 'integer', minimum: 0, description: 'Pagination offset. Defaults to 0.' },
        resultsSize: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Page size, 1-200. Defaults to 25. Use resultsOffset + searchMetadata.totalCount to page through more.',
        },
        fullDetails: {
          type: 'boolean',
          description:
            'Return raw, untrimmed company records (full objective text, board members, capital/stock structure) ' +
            'instead of the default compact projection. Defaults to false.',
        },
        requireContactInfo: {
          type: 'boolean',
          description:
            'Only return companies with at least one of phone/email/url populated (excludes rows with none). ' +
            'Filtered client-side (the GEMH API has no server-side filter for this), so a page may return fewer rows ' +
            'than resultsSize; see droppedNoContactCount. Defaults to false (no filtering).',
        },
        prioritizeCompleteRecords: {
          type: 'boolean',
          description:
            'Reorder this page so companies with an objective and/or listed persons come before "shell" records ' +
            '(neither) — shells correlate with a much lower enrichment hit rate. IMPORTANT: this only reorders the ' +
            'rows already returned on this page; it cannot change which companies land on which page (that\'s still ' +
            'governed by resultsSortBy across the full registry), so it\'s most useful with a larger resultsSize. ' +
            'Defaults to false.',
        },
      },
    },
    handler: async (client, args) => {
      const { fullDetails, requireContactInfo, prioritizeCompleteRecords, ...apiArgs } = args;
      const result = await client.get(
        '/companies',
        { ...apiArgs, resultsSize: apiArgs.resultsSize ?? 25 },
        { notFoundIsNull: true },
      );
      // The API returns 404 (not an empty 200 array) when a search yields zero
      // matches — normalize that into a proper empty result set rather than
      // surfacing it as an error.
      if (result === null) {
        return {
          searchMetadata: { totalCount: 0, resultsOffset: apiArgs.resultsOffset ?? 0, resultsSize: 0 },
          searchResults: [],
        };
      }
      if (Array.isArray(result.searchResults)) {
        if (requireContactInfo) {
          const before = result.searchResults.length;
          result.searchResults = result.searchResults.filter(hasAnyContactInfo);
          const dropped = before - result.searchResults.length;
          if (dropped > 0) {
            result.droppedNoContactCount = dropped;
          }
        }
        if (prioritizeCompleteRecords) {
          // Stable sort (Array.prototype.sort is spec-guaranteed stable):
          // non-shell rows first, shells last, original order preserved within each group.
          result.searchResults = [...result.searchResults].sort(
            (a, b) => Number(isShellRecord(a)) - Number(isShellRecord(b)),
          );
        }
        if (!fullDetails) {
          result.searchResults = result.searchResults.map(toCompactCompany);
        }
      }
      return result;
    },
  },
  {
    name: 'gemh_get_company',
    annotations: { title: 'gemh_get_company', ...READONLY_EXTERNAL },
    description: 'Get the full public record for one company by its ΓΕΜΗ registry number (arGemi).',
    inputSchema: {
      type: 'object',
      properties: {
        arGemi: { type: 'string', description: 'The ΓΕΜΗ registry number.' },
      },
      required: ['arGemi'],
    },
    handler: async (client, args) => {
      const result = await client.get(`/companies/${encodeURIComponent(String(args.arGemi))}`, undefined, {
        notFoundIsNull: true,
      });
      if (result === null) {
        throw new Error(`No company found with ΓΕΜΗ number ${args.arGemi}.`);
      }
      return result;
    },
  },
  {
    name: 'gemh_get_company_documents',
    annotations: { title: 'gemh_get_company_documents', ...READONLY_EXTERNAL },
    description:
      'Get the public documents (ΓΕΜΗ decisions/announcements, publications) for one company by its ΓΕΜΗ registry ' +
      'number. Each document includes a download URL — fetching it directly requires the same api_key header, or use ' +
      'gemh_download_file with the key/elementId shown in the URL.',
    inputSchema: {
      type: 'object',
      properties: {
        arGemi: { type: 'string', description: 'The ΓΕΜΗ registry number.' },
      },
      required: ['arGemi'],
    },
    handler: async (client, args) => {
      const result = await client.get(
        `/companies/${encodeURIComponent(String(args.arGemi))}/documents`,
        undefined,
        { notFoundIsNull: true },
      );
      if (result === null) {
        throw new Error(`No company found with ΓΕΜΗ number ${args.arGemi}.`);
      }
      return result;
    },
  },
  {
    name: 'gemh_search_activities',
    annotations: { title: 'gemh_search_activities', ...READONLY_EXTERNAL },
    description:
      'Keyword-search the ΚΑΔ business activity classification (~19k entries, cached locally) to find the activity ' +
      'ids to feed into gemh_search_companies. This is the starting point for "which businesses do X" prospecting — ' +
      'e.g. query "λογιστικά" or "accounting" to find accounting-related ΚΑΔ codes. Matching is accent- and case-insensitive ' +
      'and searches both the Greek and English descriptions. Both the legacy (kad_2008) and current (kad_2026) ' +
      'classifications are searched by default since live company records use both.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          description: 'Keyword(s) to match against activity descriptions, e.g. "λογιστικά" or "web design".',
        },
        kadVersion: {
          type: 'string',
          enum: ['kad_2008', 'kad_2026', 'all'],
          description: 'Restrict to one ΚΑΔ classification version. Defaults to "all".',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results to return. Defaults to 30.' },
      },
      required: ['query'],
    },
    handler: async (client, args) => {
      return searchActivities(client, String(args.query), {
        kadVersion: args.kadVersion as any,
        limit: args.limit as number | undefined,
      });
    },
  },
  {
    name: 'gemh_get_prefectures',
    annotations: { title: 'gemh_get_prefectures', ...READONLY_EXTERNAL },
    description: 'List prefectures (νομοί), optionally filtered by a keyword. Small, cached list (~56 rows).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword filter (Greek or English).' } },
    },
    handler: async (client, args) => getPrefectures(client, args.query as string | undefined),
  },
  {
    name: 'gemh_get_municipalities',
    annotations: { title: 'gemh_get_municipalities', ...READONLY_EXTERNAL },
    description:
      'List municipalities (δήμοι), optionally filtered by prefecture id and/or a keyword. Cached list (~333 rows).',
    inputSchema: {
      type: 'object',
      properties: {
        prefectureId: { type: 'string', description: 'Restrict to municipalities within this prefecture id.' },
        query: { type: 'string', description: 'Optional keyword filter (Greek or English).' },
      },
    },
    handler: async (client, args) =>
      getMunicipalities(client, {
        prefectureId: args.prefectureId as string | undefined,
        query: args.query as string | undefined,
      }),
  },
  {
    name: 'gemh_get_company_statuses',
    annotations: { title: 'gemh_get_company_statuses', ...READONLY_EXTERNAL },
    description: 'List company status codes (e.g. active, dissolved, under liquidation). Small, cached list.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword filter (Greek or English).' } },
    },
    handler: async (client, args) => getCompanyStatuses(client, args.query as string | undefined),
  },
  {
    name: 'gemh_get_legal_types',
    annotations: { title: 'gemh_get_legal_types', ...READONLY_EXTERNAL },
    description: 'List legal form codes (ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ...). Small, cached list.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword filter (Greek or English).' } },
    },
    handler: async (client, args) => getLegalTypes(client, args.query as string | undefined),
  },
  {
    name: 'gemh_get_gemi_offices',
    annotations: { title: 'gemh_get_gemi_offices', ...READONLY_EXTERNAL },
    description: 'List local ΓΕΜΗ offices / chambers of commerce. Small, cached list (~61 rows).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword filter (Greek or English).' } },
    },
    handler: async (client, args) => getGemiOffices(client, args.query as string | undefined),
  },
  {
    name: 'gemh_get_assembly_subjects',
    annotations: { title: 'gemh_get_assembly_subjects', ...READONLY_EXTERNAL },
    description: 'List ΓΕΜΗ general assembly decision subject codes. Small, cached list (~114 rows).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword filter (Greek or English).' } },
    },
    handler: async (client, args) => getAssemblySubjects(client, args.query as string | undefined),
  },
  {
    name: 'gemh_download_file',
    annotations: { title: 'gemh_download_file', ...READONLY_EXTERNAL },
    description:
      'Download one document referenced by a company\'s documents list (gemh_get_company_documents), by its key and ' +
      'elementId (both shown in the document\'s URL). Returns the file inline as base64 if it is under ~3MB; otherwise ' +
      'returns metadata only and the caller should fetch the URL directly with the api_key header.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The "key" query param from the document URL, e.g. "assemblyDecision".' },
        elementId: { type: 'integer', description: 'The "elementId" query param from the document URL.' },
      },
      required: ['key', 'elementId'],
    },
    handler: async (client, args) => {
      const result = await client.getBinary('/downloadFile', args, MAX_DOWNLOAD_BYTES);
      if (result.tooLarge) {
        return {
          tooLarge: true,
          contentType: result.contentType,
          contentLength: result.contentLength,
          message: `File exceeds the ${MAX_DOWNLOAD_BYTES} byte inline limit; fetch the downloadFile URL directly with the api_key header instead.`,
        };
      }
      return {
        contentType: result.contentType,
        byteLength: result.buffer.length,
        base64: result.buffer.toString('base64'),
      };
    },
  },
  {
    name: 'gemh_health_check',
    annotations: { title: 'gemh_health_check', ...READONLY_EXTERNAL },
    description: 'Check whether the ΓΕΜΗ Open Data API is currently up.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (client) => client.get('/health'),
  },
];

export async function createGemhMcpServer(opts: CreateServerOptions): Promise<Server> {
  const client = new GemhClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    maxRequestsPerMinute: opts.maxRequestsPerMinute,
  });

  const server = new Server(
    { name: 'gemh-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'gemh://docs/openapi',
        name: 'ΓΕΜΗ Open Data API specification',
        mimeType: 'application/json',
        description: 'The full Swagger 2.0 specification for the ΓΕΜΗ Open Data API.',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri === 'gemh://docs/openapi') {
      const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemh-api-docs.json');
      const text = await readFile(specPath, 'utf8');
      return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text }] };
    }
    throw new Error(`Resource not found: ${req.params.uri}`);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    const result = await tool.handler(client, (req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

export { TOOLS };
