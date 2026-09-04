import type { GemhClient } from './gemhClient.js';
import { readDiskCache, writeDiskCache } from './cache.js';
import { normalizeGreek, toSearchStem, tokenize } from './text.js';

// GEMH is mid-transition between the "kad_2008" and "kad_2026" ΚΑΔ (business
// activity) classifications — both versions coexist in the ~19k-row list and in
// live company records, so a keyword search must cover both unless narrowed.
export type KadVersion = 'kad_2008' | 'kad_2026' | 'all';

export type Activity = {
  id: string;
  descr: string;
  descrEn?: string;
  kadVersion?: string;
  lastUpdated?: string;
};

const CACHE_KEY = 'activities';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week — this list is large (~19k rows); refresh sparingly

let memCache: Activity[] | null = null;

async function loadActivities(client: GemhClient): Promise<Activity[]> {
  if (memCache) return memCache;

  const disk = await readDiskCache<Activity[]>(CACHE_KEY, TTL_MS);
  if (disk) {
    memCache = disk;
    return memCache;
  }

  const data = (await client.get('/metadata/activities')) as Activity[];
  memCache = data;
  await writeDiskCache(CACHE_KEY, data);
  return memCache;
}

export async function searchActivities(
  client: GemhClient,
  query: string,
  opts: { kadVersion?: KadVersion; limit?: number } = {},
): Promise<{ totalMatches: number; results: Activity[] }> {
  const all = await loadActivities(client);
  const kadVersion = opts.kadVersion ?? 'all';
  const limit = opts.limit ?? 30;

  const stems = tokenize(query).map(toSearchStem);
  if (stems.length === 0) return { totalMatches: 0, results: [] };

  const matches = all.filter((activity) => {
    if (kadVersion !== 'all' && activity.kadVersion !== kadVersion) return false;
    const haystack = normalizeGreek(`${activity.descr} ${activity.descrEn ?? ''}`);
    return stems.every((stem) => haystack.includes(stem));
  });

  // Shorter descriptions tend to be the more general/relevant match for a keyword.
  matches.sort((a, b) => a.descr.length - b.descr.length || a.id.localeCompare(b.id));

  return { totalMatches: matches.length, results: matches.slice(0, limit) };
}
