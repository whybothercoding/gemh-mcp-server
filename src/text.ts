/**
 * GEMH activity/metadata descriptions are stored in upper-case Greek with tonos
 * accents (e.g. "ΛΟΓΙΣΤΙΚΑ"). Callers often type without accents, so keyword
 * search needs to be both case- and accent-insensitive to be usable.
 */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeGreek(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase();
}

export function tokenize(query: string): string[] {
  return normalizeGreek(query).split(/\s+/).filter(Boolean);
}

/**
 * Greek is heavily inflected (case/gender/number endings), so an exact-word
 * substring match misses obvious hits — e.g. query "ΛΟΓΙΣΤΙΚΑ" (neuter) won't
 * match a stored description containing "ΛΟΓΙΣΤΙΚΕΣ" (feminine) even though
 * both mean "accounting". Truncating longer tokens to a ~6-char prefix is a
 * cheap stand-in for real stemming that tolerates most suffix variation
 * without over-matching short/generic words.
 */
export function toSearchStem(token: string): string {
  return token.length > 6 ? token.slice(0, 6) : token;
}
