import type { GemhClient } from './gemhClient.js';
import { readDiskCache, writeDiskCache } from './cache.js';
import { normalizeGreek, toSearchStem, tokenize } from './text.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 1 day — small reference lists, safe to refresh often

export type MetadataItem = Record<string, unknown> & { descr?: string; descrEn?: string };

const memCaches = new Map<string, MetadataItem[]>();

async function loadList(client: GemhClient, endpointPath: string, cacheKey: string): Promise<MetadataItem[]> {
  const mem = memCaches.get(cacheKey);
  if (mem) return mem;

  const disk = await readDiskCache<MetadataItem[]>(cacheKey, TTL_MS);
  if (disk) {
    memCaches.set(cacheKey, disk);
    return disk;
  }

  const data = (await client.get(endpointPath)) as MetadataItem[];
  memCaches.set(cacheKey, data);
  await writeDiskCache(cacheKey, data);
  return data;
}

function filterByQuery(items: MetadataItem[], query?: string): MetadataItem[] {
  if (!query) return items;
  const stems = tokenize(query).map(toSearchStem);
  if (stems.length === 0) return items;
  return items.filter((item) => {
    const haystack = normalizeGreek(`${item.descr ?? ''} ${item.descrEn ?? ''}`);
    return stems.every((stem) => haystack.includes(stem));
  });
}

export async function getPrefectures(client: GemhClient, query?: string): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/prefectures', 'prefectures');
  return filterByQuery(all, query);
}

export async function getMunicipalities(
  client: GemhClient,
  opts: { prefectureId?: string; query?: string } = {},
): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/municipalities', 'municipalities');
  const byPrefecture = opts.prefectureId
    ? all.filter((item) => String(item.prefectureId) === String(opts.prefectureId))
    : all;
  return filterByQuery(byPrefecture, opts.query);
}

export async function getCompanyStatuses(client: GemhClient, query?: string): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/companyStatuses', 'companyStatuses');
  return filterByQuery(all, query);
}

export async function getLegalTypes(client: GemhClient, query?: string): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/legalTypes', 'legalTypes');
  return filterByQuery(all, query);
}

export async function getGemiOffices(client: GemhClient, query?: string): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/gemiOffices', 'gemiOffices');
  return filterByQuery(all, query);
}

export async function getAssemblySubjects(client: GemhClient, query?: string): Promise<MetadataItem[]> {
  const all = await loadList(client, '/metadata/assemblySubjects', 'assemblySubjects');
  return filterByQuery(all, query);
}
