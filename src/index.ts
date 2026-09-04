import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGemhMcpServer } from './server.js';

const apiKey = process.env.GEMH_API_KEY;
if (!apiKey) {
  // MCP servers are launched by their client (Claude Code / Desktop), which is
  // responsible for injecting the env var — we never read secrets from files.
  throw new Error('Missing required env var GEMH_API_KEY');
}

const baseUrl = process.env.GEMH_BASE_URL;
const maxRequestsPerMinute = process.env.GEMH_MAX_REQUESTS_PER_MINUTE
  ? Number(process.env.GEMH_MAX_REQUESTS_PER_MINUTE)
  : undefined;

const server = await createGemhMcpServer({ apiKey, baseUrl, maxRequestsPerMinute });

const transport = new StdioServerTransport();
await server.connect(transport);
