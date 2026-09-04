import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// GEMH techdocs guidance: parametric data (activities, prefectures, municipalities,
// statuses, legal types, ...) "doesn't change frequently" and should be cached
// locally. We persist to disk so a fresh server process doesn't have to re-fetch
// the ~19k-row activity list on every restart.
const CACHE_DIR = path.join(os.homedir(), '.cache', 'gemh-mcp-server');

type CacheEnvelope<T> = { fetchedAt: number; data: T };

export async function readDiskCache<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8');
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (Date.now() - envelope.fetchedAt > ttlMs) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

export async function writeDiskCache<T>(key: string, data: T): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const envelope: CacheEnvelope<T> = { fetchedAt: Date.now(), data };
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(envelope), 'utf8');
  } catch (err) {
    // Non-fatal: worst case we re-fetch from the API next time.
    console.error(`gemh-mcp-server: could not persist cache "${key}": ${(err as Error).message}`);
  }
}
