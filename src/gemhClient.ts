import { request } from 'undici';
import { RateLimiter } from './rateLimiter.js';

// Confirmed production limit: 8 requests/minute per API key. Enforced here
// (rather than left to callers) since a single prospecting session easily
// fans out across several tools — metadata lookups, an activities search,
// a company search, a documents lookup — that would otherwise 429.
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;

export type GemhClientOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRequestsPerMinute?: number;
};

export type BinaryResult =
  | { status: number; tooLarge: true; contentType: string; contentLength?: number }
  | { status: number; tooLarge: false; contentType: string; contentLength?: number; buffer: Buffer };

function extractErrorMessage(text: string, contentType: string): string {
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        return data.map((e: any) => `${e.code ?? '?'}: ${e.message ?? JSON.stringify(e)}`).join('; ');
      }
      if (data?.message) return String(data.message);
      return JSON.stringify(data);
    } catch {
      // fall through to HTML/raw handling below
    }
  }

  // The upstream swagger-tools validator returns HTML stack-trace pages for 400s
  // (e.g. "Parameter (afm) is too short (3 chars), minimum 9") instead of the
  // documented ErrorEntry[] JSON — pull the readable first line out of the <pre>.
  const preMatch = text.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    const firstLine = preMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/g, ' ')
      .split('\n')[0]
      .trim();
    if (firstLine) return firstLine;
  }

  return text.slice(0, 2000) || '(empty response body)';
}

export class GemhClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private rateLimiter: RateLimiter;

  constructor(opts: GemhClientOptions) {
    if (!opts.apiKey) throw new Error('apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://opendata-api.businessportal.gr/api/opendata/v1').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.rateLimiter = new RateLimiter(
      opts.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE,
      RATE_LIMIT_WINDOW_MS,
    );
  }

  private buildUrl(path: string, query?: Record<string, unknown>): URL {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          if (value.length === 0) continue;
          url.searchParams.set(key, value.join(','));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }

  /**
   * GET request returning parsed JSON (or null on a 404 when the caller opts in
   * to treating "not found" as "no data" rather than an error — the /companies
   * search endpoint uses 404 for zero matches instead of an empty 200 array).
   */
  async get(path: string, query?: Record<string, unknown>, opts?: { notFoundIsNull?: boolean }): Promise<any> {
    const url = this.buildUrl(path, query);
    await this.rateLimiter.acquire();
    const res = await request(url, {
      method: 'GET',
      headers: { api_key: this.apiKey },
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });

    const contentType = String(res.headers['content-type'] ?? '');
    const text = await res.body.text();

    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (!text) return null;
      if (contentType.includes('application/json')) {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      }
      return { raw: text };
    }

    if (res.statusCode === 404 && opts?.notFoundIsNull) {
      return null;
    }

    throw new Error(`GEMH API error ${res.statusCode} on ${path}: ${extractErrorMessage(text, contentType)}`);
  }

  /**
   * GET request for binary payloads (e.g. downloadFile), guarding against
   * accidentally pulling a huge PDF into the conversation. Returns tooLarge:true
   * instead of a buffer when the payload exceeds maxBytes.
   */
  async getBinary(path: string, query: Record<string, unknown>, maxBytes: number): Promise<BinaryResult> {
    const url = this.buildUrl(path, query);
    await this.rateLimiter.acquire();
    const res = await request(url, {
      method: 'GET',
      headers: { api_key: this.apiKey },
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });

    const contentType = String(res.headers['content-type'] ?? 'application/octet-stream');
    const contentLengthHeader = res.headers['content-length'];
    const contentLength = contentLengthHeader
      ? Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader)
      : undefined;

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new Error(`GEMH API error ${res.statusCode} on ${path}: ${extractErrorMessage(text, contentType)}`);
    }

    if (contentLength !== undefined && contentLength > maxBytes) {
      await res.body.dump();
      return { status: res.statusCode, tooLarge: true, contentType, contentLength };
    }

    // Many GEMH responses (e.g. downloadFile) use chunked transfer with no
    // Content-Length, so size can only be known while streaming. Breaking out
    // of the loop (rather than calling res.body.dump() from inside it) lets
    // for-await's own iterator cleanup cancel the stream — calling dump()
    // while the loop still holds the iterator double-consumes the body and
    // hangs indefinitely.
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        break;
      }
      chunks.push(chunk as Buffer);
    }

    if (tooLarge) {
      return { status: res.statusCode, tooLarge: true, contentType, contentLength };
    }
    return { status: res.statusCode, tooLarge: false, contentType, contentLength, buffer: Buffer.concat(chunks) };
  }
}
