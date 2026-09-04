// A raw Company record can be enormous — the `objective` field is often several
// KB of legal boilerplate, and `persons`/`capital`/`stocks` add board-member and
// share-structure detail that's irrelevant when scanning search results for
// prospects. 5 raw records from gemh_search_companies measured at 224k+
// characters in practice. This trims each row to what prospecting actually
// needs; gemh_get_company still returns the full record for a single company.
const OBJECTIVE_EXCERPT_LENGTH = 240;

// Long-lived companies often carry dozens of secondary ΚΑΔ activities, and the
// kad_2008 -> kad_2026 transition means the same activity id can appear twice
// (identical id/descr/type) once kadVersion is dropped from the compact view.
// Cap + dedupe rather than passing that bulk straight through.
const ACTIVITY_LIMIT = 20;

function compactActivities(rawActivities: unknown): { activities: Record<string, unknown>[]; omittedActivityCount: number } {
  if (!Array.isArray(rawActivities)) return { activities: [], omittedActivityCount: 0 };

  // Prefer the kad_2026 entry when the same ΚΑΔ id appears under both
  // classification versions — otherwise the compact view shows literal
  // duplicate rows that add nothing.
  const byId = new Map<string, Record<string, any>>();
  for (const a of rawActivities as Record<string, any>[]) {
    const id = a?.activity?.id;
    if (id === undefined) continue;
    const existing = byId.get(id);
    if (!existing || a.activity?.kadVersion === 'kad_2026') {
      byId.set(id, a);
    }
  }

  // Primary (Κύρια) activities first — most relevant for identifying what a
  // company actually does; Array.prototype.sort is stable so ordering within
  // each group is otherwise preserved.
  const deduped = [...byId.values()].sort(
    (a, b) => (a.type === 'Κύρια' ? -1 : 0) - (b.type === 'Κύρια' ? -1 : 0),
  );

  const limited = deduped.slice(0, ACTIVITY_LIMIT);
  return {
    activities: limited.map((a) => ({ id: a.activity?.id, descr: a.activity?.descr, type: a.type })),
    omittedActivityCount: deduped.length - limited.length,
  };
}

// autoRegistered is NOT a usable data-completeness signal: verified against a
// 200-row unfiltered sample of live search results, it is `false` for 100% of
// rows — including companies with a full objective, persons, and contact info
// (e.g. Abbott Laboratories, arGemi 268101000). Do not filter or branch on it.
export function hasAnyContactInfo(c: Record<string, any>): boolean {
  return Boolean(c.phone || c.email || c.url);
}

// A "shell" record has neither an objective nor any listed persons — verified
// against a 200-row sample: 90% of shells have no contact info at all (vs. 30%
// of non-shells), but it's not reliable enough to hard-filter on (10% of
// shells DO have contact info, and it only catches 68% of true no-contact
// rows). Use it to prioritize which companies are worth an enrichment attempt
// first, not to exclude candidates outright.
export function isShellRecord(c: Record<string, any>): boolean {
  return !c.objective && (!Array.isArray(c.persons) || c.persons.length === 0);
}

export function toCompactCompany(c: Record<string, any>): Record<string, unknown> {
  const objective: string | undefined = c.objective;
  const { activities, omittedActivityCount } = compactActivities(c.activities);
  return {
    arGemi: c.arGemi,
    afm: c.afm,
    coNameEl: c.coNameEl,
    coTitlesEl: c.coTitlesEl,
    legalType: c.legalType?.descr,
    status: c.status?.descr,
    incorporationDate: c.incorporationDate,
    isBranch: c.isBranch,
    isShellRecord: isShellRecord(c),
    address: {
      street: c.street,
      streetNumber: c.streetNumber,
      city: c.city,
      zipCode: c.zipCode,
      municipality: c.municipality?.descr,
      prefecture: c.prefecture?.descr,
    },
    phone: c.phone,
    fax: c.fax,
    email: c.email,
    url: c.url,
    activities,
    ...(omittedActivityCount > 0 ? { omittedActivityCount } : {}),
    objectiveExcerpt: objective
      ? objective.slice(0, OBJECTIVE_EXCERPT_LENGTH) + (objective.length > OBJECTIVE_EXCERPT_LENGTH ? '…' : '')
      : undefined,
  };
}
