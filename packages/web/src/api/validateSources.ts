import { CANDIDATE_IDS } from '@cds/shared-types';

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function req(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);

export interface CitationDetailData {
  id: string;
  type: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  pmid: string | null;
  evidenceGrade: string;
  tableOrFigure: string;
  notes: string | null;
}

export interface DerivedFromData {
  sensitivity: number;
  specificity: number;
  n: number;
  prevalenceInStudy: number;
}

export interface LikelihoodData {
  conditionId: string;
  conditionDisplayName: string;
  featureId: string;
  featurePrompt: string | null;
  state: string;
  lr: number;
  tier: string;
  acquisitionCost: number;
  invasiveness: string;
  dependencyGroup: string | null;
  verificationStatus: string;
  derivedFrom: DerivedFromData | null;
  citation: CitationDetailData | null;
}

export interface PriorData {
  conditionId: string;
  conditionDisplayName: string;
  careSetting: string;
  weight: number;
  population: string;
  verificationStatus: string;
  citation: CitationDetailData | null;
}

export interface CitationData extends CitationDetailData {
  usedBy: string[];
  usedInUnknownAggregate: boolean;
}

export interface SourcesData {
  knowledgePackVersion: string;
  knowledgePackHash: string;
  generatedAt: string;
  featureLikelihoods: LikelihoodData[];
  priors: PriorData[];
  citations: CitationData[];
  unknownAggregate: { itemised: false; valueCount: number };
}

const GRADES: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D']);
const ALLOWED_CONDITIONS: ReadonlySet<string> = new Set<string>(CANDIDATE_IDS);

function checkCitation(c: unknown, where: string): CitationDetailData {
  req(isRecord(c), `${where}: citation malformed`);
  req(isStr(c.id) && isStr(c.type) && isStr(c.title) && isStr(c.authors), `${where}: citation malformed`);
  req(c.year === null || isNum(c.year), `${where}: citation year malformed`);
  req(isStrOrNull(c.doi) && isStrOrNull(c.pmid) && isStrOrNull(c.notes), `${where}: citation malformed`);
  req(isStr(c.evidenceGrade) && GRADES.has(c.evidenceGrade), `${where}: evidence grade must be A to D`);
  req(isStr(c.tableOrFigure), `${where}: citation malformed`);
  return c as unknown as CitationDetailData;
}

/**
 * Structural check of the /sources response. Every citation a row points at
 * must exist in the citation index, so a link from any row always resolves.
 */
export function assertSourcesData(value: unknown): SourcesData {
  req(isRecord(value), 'response is not an object');
  // Tripwire: no hidden-condition name may reach any screen.
  req(!/shadow/i.test(JSON.stringify(value)), 'response names a hidden condition');

  req(isStr(value.knowledgePackVersion) && isStr(value.knowledgePackHash), 'missing pack version or hash');
  req(isStr(value.generatedAt), 'missing generatedAt');
  req(Array.isArray(value.featureLikelihoods), 'missing featureLikelihoods');
  req(Array.isArray(value.priors), 'missing priors');
  req(Array.isArray(value.citations), 'missing citations');

  const unknown = value.unknownAggregate;
  req(isRecord(unknown) && unknown.itemised === false && isNum(unknown.valueCount), 'missing unknownAggregate');

  const indexed = new Set<string>();
  for (const c of value.citations) {
    checkCitation(c, 'citation index');
    const rec = c as Rec;
    req(Array.isArray(rec.usedBy) && rec.usedBy.every(isStr), 'citation usedBy malformed');
    req(typeof rec.usedInUnknownAggregate === 'boolean', 'citation usedInUnknownAggregate missing');
    indexed.add(rec.id as string);
  }

  for (const row of value.featureLikelihoods) {
    req(isRecord(row), 'malformed likelihood row');
    req(isStr(row.conditionId) && ALLOWED_CONDITIONS.has(row.conditionId), 'unexpected condition in likelihood row');
    req(isStr(row.conditionDisplayName) && isStr(row.featureId) && isStr(row.state), 'malformed likelihood row');
    req(isStrOrNull(row.featurePrompt), 'likelihood featurePrompt malformed');
    req(isNum(row.lr) && isNum(row.acquisitionCost), 'malformed likelihood row');
    req(isStr(row.tier) && isStr(row.verificationStatus) && isStr(row.invasiveness), 'malformed likelihood row');
    req(isStrOrNull(row.dependencyGroup), 'likelihood dependencyGroup malformed');
    if (row.derivedFrom !== null) {
      const d = row.derivedFrom;
      req(
        isRecord(d) && isNum(d.sensitivity) && isNum(d.specificity) && isNum(d.n) && isNum(d.prevalenceInStudy),
        'likelihood derivedFrom malformed',
      );
    }
    if (row.citation !== null) {
      const c = checkCitation(row.citation, `likelihood ${row.featureId}`);
      req(indexed.has(c.id), `citation ${c.id} is missing from the citation index`);
    }
  }

  for (const row of value.priors) {
    req(isRecord(row), 'malformed prior row');
    req(isStr(row.conditionId) && ALLOWED_CONDITIONS.has(row.conditionId), 'unexpected condition in prior row');
    req(isStr(row.conditionDisplayName) && isStr(row.careSetting), 'malformed prior row');
    req(isNum(row.weight) && isStr(row.population) && isStr(row.verificationStatus), 'malformed prior row');
    if (row.citation !== null) {
      const c = checkCitation(row.citation, `prior ${row.conditionId}`);
      req(indexed.has(c.id), `citation ${c.id} is missing from the citation index`);
    }
  }

  return value as unknown as SourcesData;
}