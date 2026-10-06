/**
 * Display mapping, search and filtering for the Sources screen. Rows keep the
 * order the server sent: nothing here sorts, ranks, or styles by grade.
 * Search and filters only match strings and toggle sets.
 */
import { CARE_SETTING_LABELS } from '../intake/view-model';
import { sentenceCase } from '../active/view-model';
import type {
  CitationData,
  CitationDetailData,
  LikelihoodData,
  PriorData,
  SourcesData,
} from '../../api/validateSources';
import type {
  ChipView,
  CitationDetailView,
  CitationLinkView,
  CitationRowView,
  HeaderView,
  LikelihoodRowView,
  PriorRowView,
  SourcesScreenProps,
  TabId,
  TabView,
} from './SourcesScreen';

export interface SourcesFilters {
  query: string;
  conditions: ReadonlySet<string>;
  grades: ReadonlySet<string>;
}

export const NO_FILTERS: SourcesFilters = {
  query: '',
  conditions: new Set<string>(),
  grades: new Set<string>(),
};

export type SourcesView = Omit<
  SourcesScreenProps,
  'onQueryChange' | 'onToggleCondition' | 'onToggleGrade' | 'onTabChange' | 'onClearFilters'
>;

export interface SourcesContext {
  sessionId: string | null;
  lastOkAt: Date;
  focusId?: string;
}

// The grade letters are fixed; their meaning is not defined in the pack, so
// none is invented here.
const GRADES: readonly string[] = ['A', 'B', 'C', 'D'];
const NOT_RECORDED = 'Not recorded';
const UNKNOWN_CITED_BY = 'Unknown (values not itemised)';

export const N_FOOTNOTE =
  'n is shown as recorded in the pack; it may count studies or patients.';

export function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Facets {
  conditionIds: readonly string[];
  grade: string | null;
  haystack: ReadonlyArray<string | null>;
}

function matchesQuery(facets: Facets, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return true;
  const text = facets.haystack
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();
  return terms.every((t) => text.includes(t));
}

function matchesConditions(facets: Facets, filters: SourcesFilters): boolean {
  if (filters.conditions.size === 0) return true;
  return facets.conditionIds.some((id) => filters.conditions.has(id));
}

function matchesGrades(facets: Facets, filters: SourcesFilters): boolean {
  if (filters.grades.size === 0) return true;
  return facets.grade !== null && filters.grades.has(facets.grade);
}

function visible(facets: Facets, filters: SourcesFilters): boolean {
  return matchesQuery(facets, filters.query) && matchesConditions(facets, filters) && matchesGrades(facets, filters);
}

function likelihoodFacets(e: LikelihoodData): Facets {
  return {
    conditionIds: [e.conditionId],
    grade: e.citation ? e.citation.evidenceGrade : null,
    haystack: [
      e.conditionDisplayName,
      e.featureId,
      e.featurePrompt,
      e.state.replace(/_/g, ' '),
      e.citation ? e.citation.id : null,
      e.citation ? e.citation.title : null,
      e.citation ? e.citation.authors : null,
    ],
  };
}

function priorFacets(e: PriorData): Facets {
  return {
    conditionIds: [e.conditionId],
    grade: e.citation ? e.citation.evidenceGrade : null,
    haystack: [
      e.conditionDisplayName,
      e.careSetting.replace(/_/g, ' '),
      e.population,
      e.citation ? e.citation.id : null,
      e.citation ? e.citation.title : null,
      e.citation ? e.citation.authors : null,
    ],
  };
}

function citationFacets(c: CitationData): Facets {
  return {
    conditionIds: c.usedBy,
    grade: c.evidenceGrade,
    haystack: [c.id, c.title, c.authors, c.type.replace(/_/g, ' '), c.tableOrFigure],
  };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toDetail(c: CitationDetailData, citedBy: string[]): CitationDetailView {
  return {
    id: c.id,
    title: c.title,
    authors: c.authors,
    yearLabel: c.year === null ? NOT_RECORDED : String(c.year),
    typeLabel: sentenceCase(c.type),
    gradeLabel: `Grade ${c.evidenceGrade}`,
    tableOrFigure: c.tableOrFigure,
    doiLabel: c.doi ?? NOT_RECORDED,
    pmidLabel: c.pmid ?? NOT_RECORDED,
    notes: c.notes === null ? null : c.notes.trim(),
    citedBy,
  };
}

function toLink(c: CitationDetailData): CitationLinkView {
  // In-page: the container follows the hash to the Citations tab.
  return { id: c.id, label: c.id, href: `#${encodeURIComponent(c.id)}` };
}

function gradeLabel(c: CitationDetailData | null): string | null {
  return c === null ? null : `Grade ${c.evidenceGrade}`;
}

function careSettingLabel(id: string): string {
  return (CARE_SETTING_LABELS as Record<string, string>)[id] ?? id;
}

function packLabel(data: SourcesData): string {
  const h = data.knowledgePackHash;
  const short = h.length > 16 ? `${h.slice(0, 11)}…${h.slice(-4)}` : h;
  return `Pack ${data.knowledgePackVersion} · ${short}`;
}

function toHeader(data: SourcesData, ctx: SourcesContext): HeaderView {
  return {
    packLabel: packLabel(data),
    backHref: ctx.sessionId === null ? '/intake' : `/session/${encodeURIComponent(ctx.sessionId)}/active`,
    backLabel: ctx.sessionId === null ? 'Start a session' : 'Back to consultation',
    connectionLabel: `Connected · updated ${ctx.lastOkAt.toLocaleTimeString('en-GB')}`,
    connectionOk: true,
  };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function toSourcesView(
  data: SourcesData,
  filters: SourcesFilters,
  tab: TabId,
  ctx: SourcesContext,
): SourcesView {
  // Display names come from the server, not from a client-side table.
  const names = new Map<string, string>();
  for (const e of data.featureLikelihoods) names.set(e.conditionId, e.conditionDisplayName);
  for (const e of data.priors) names.set(e.conditionId, e.conditionDisplayName);

  const index = new Map<string, CitationData>(data.citations.map((c) => [c.id, c]));

  const citedByOf = (c: CitationData): string[] => {
    const out = c.usedBy.map((id) => names.get(id) ?? id);
    if (c.usedInUnknownAggregate) out.push(UNKNOWN_CITED_BY);
    return out;
  };

  const detailFor = (c: CitationDetailData | null): CitationDetailView | null => {
    if (c === null) return null;
    const indexed = index.get(c.id);
    return indexed ? toDetail(indexed, citedByOf(indexed)) : toDetail(c, []);
  };

  const likeFacets = data.featureLikelihoods.map(likelihoodFacets);
  const priorFacetList = data.priors.map(priorFacets);
  const citeFacets = data.citations.map(citationFacets);

  const likelihoods: LikelihoodRowView[] = [];
  data.featureLikelihoods.forEach((e, i) => {
    if (!visible(likeFacets[i]!, filters)) return;
    const d = e.derivedFrom;
    likelihoods.push({
      key: `${e.conditionId}|${e.featureId}|${e.state}`,
      conditionName: e.conditionDisplayName,
      findingLabel: e.featurePrompt ?? e.featureId,
      stateLabel: sentenceCase(e.state),
      lrLabel: String(e.lr),
      gradeLabel: gradeLabel(e.citation),
      derivedLabel: d ? `${d.sensitivity} / ${d.specificity} / ${d.n}` : '—',
      tierLabel: sentenceCase(e.tier),
      costLabel: String(e.acquisitionCost),
      verificationLabel: sentenceCase(e.verificationStatus),
      citation: e.citation ? toLink(e.citation) : null,
      detail: detailFor(e.citation),
    });
  });

  const priors: PriorRowView[] = [];
  data.priors.forEach((e, i) => {
    if (!visible(priorFacetList[i]!, filters)) return;
    priors.push({
      key: `${e.conditionId}|${e.careSetting}`,
      conditionName: e.conditionDisplayName,
      careSettingLabel: careSettingLabel(e.careSetting),
      weightLabel: String(e.weight),
      population: e.population.trim(),
      gradeLabel: gradeLabel(e.citation),
      verificationLabel: sentenceCase(e.verificationStatus),
      citation: e.citation ? toLink(e.citation) : null,
      detail: detailFor(e.citation),
    });
  });

  const citations: CitationRowView[] = [];
  data.citations.forEach((c, i) => {
    if (!visible(citeFacets[i]!, filters)) return;
    citations.push({ key: c.id, detail: toDetail(c, citedByOf(c)) });
  });

  const tabs: TabView[] = [
    { id: 'likelihoods', label: 'Likelihood ratios', count: likelihoods.length },
    { id: 'priors', label: 'Priors', count: priors.length },
    { id: 'citations', label: 'Citations', count: citations.length },
  ];

  const facetsByTab: Record<TabId, Facets[]> = {
    likelihoods: likeFacets,
    priors: priorFacetList,
    citations: citeFacets,
  };
  const shownByTab: Record<TabId, number> = {
    likelihoods: likelihoods.length,
    priors: priors.length,
    citations: citations.length,
  };

  // Chips list the conditions actually present, in the order the server sent.
  const conditionIds: string[] = [];
  for (const e of [...data.featureLikelihoods, ...data.priors]) {
    if (!conditionIds.includes(e.conditionId)) conditionIds.push(e.conditionId);
  }
  const conditionChips: ChipView[] = conditionIds.map((id) => ({
    value: id,
    label: names.get(id) ?? id,
    selected: filters.conditions.has(id),
  }));

  // Grade counts respect the search and condition filters but not the grade
  // filter itself, so a chip shows how many rows it would add.
  const gradeChips: ChipView[] = GRADES.map((g) => {
    const n = facetsByTab[tab].filter(
      (f) => f.grade === g && matchesQuery(f, filters.query) && matchesConditions(f, filters),
    ).length;
    return { value: g, label: `${g} (${n})`, selected: filters.grades.has(g) };
  });

  const noun = tab === 'citations' ? 'sources' : 'rows';

  return {
    header: toHeader(data, ctx),
    unknownNote:
      `Values behind "Unknown" are not itemised (${data.unknownAggregate.valueCount} values). ` +
      `Their sources are grouped as "Basis for Unknown".`,
    query: filters.query,
    conditionChips,
    gradeChips,
    tab,
    tabs,
    countLabel: `Showing ${shownByTab[tab]} of ${facetsByTab[tab].length} ${noun}`,
    likelihoods,
    priors,
    citations,
    nLabelFootnote: N_FOOTNOTE,
    focusId: ctx.focusId,
  };
}