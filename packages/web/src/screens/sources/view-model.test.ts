import { describe, it, expect } from 'vitest';
import { NO_FILTERS, toggled, toSourcesView, type SourcesFilters } from './view-model';
import type { CitationData, SourcesData } from '../../api/validateSources';

function cite(id: string, grade: string, over: Partial<CitationData> = {}): CitationData {
  return {
    id,
    type: 'SYSTEMATIC_REVIEW',
    title: `Title of ${id}`,
    authors: 'Author A',
    year: 2005,
    doi: 'to_verify',
    pmid: null,
    evidenceGrade: grade,
    tableOrFigure: 'Table 3',
    notes: 'Some notes.\n',
    usedBy: [],
    usedInUnknownAggregate: false,
    ...over,
  };
}

const wang = cite('wang_2005', 'A', { usedBy: ['CONGESTIVE_HEART_FAILURE'] });
const afp = cite('afp_2024', 'C', { usedBy: ['ACUTE_PERICARDITIS'], title: 'Acute pericarditis review' });
const basis = cite('UNKNOWN_BASIS', 'D', { usedInUnknownAggregate: true, doi: null, year: null });

const data: SourcesData = {
  knowledgePackVersion: '2026.10.05.0',
  knowledgePackHash: 'sha256:51af9a4f490e6fbc74e8224262de8889f6dfbabcd3e1317b4d45fa92e0e4ed5f',
  generatedAt: '2026-10-06T00:00:00.000Z',
  featureLikelihoods: [
    {
      conditionId: 'ACUTE_PERICARDITIS',
      conditionDisplayName: 'Acute Pericarditis',
      featureId: 'PERICARDIAL_FRICTION_RUB',
      featurePrompt: 'Is a pericardial friction rub present on auscultation?',
      state: 'PRESENT',
      lr: 6.5,
      tier: 'BEDSIDE',
      acquisitionCost: 1,
      invasiveness: 'NONE',
      dependencyGroup: null,
      verificationStatus: 'unverified',
      derivedFrom: { sensitivity: 0.4, specificity: 0.94, n: 1, prevalenceInStudy: 0.044 },
      citation: afp,
    },
    {
      conditionId: 'CONGESTIVE_HEART_FAILURE',
      conditionDisplayName: 'Congestive Heart Failure',
      featureId: 'PRIOR_CHF_HISTORY',
      featurePrompt: 'Prior history of congestive heart failure?',
      state: 'PRESENT',
      lr: 5.8,
      tier: 'HISTORY',
      acquisitionCost: 1,
      invasiveness: 'NONE',
      dependencyGroup: null,
      verificationStatus: 'unverified',
      derivedFrom: { sensitivity: 0.6, specificity: 0.9, n: 7, prevalenceInStudy: 0.469 },
      citation: wang,
    },
  ],
  priors: [
    {
      conditionId: 'CONGESTIVE_HEART_FAILURE',
      conditionDisplayName: 'Congestive Heart Failure',
      careSetting: 'ED_UNDIFFERENTIATED_CHEST_PAIN',
      weight: 0.469,
      population: 'Consecutive ED patients with dyspnea.\n',
      verificationStatus: 'unverified',
      citation: wang,
    },
  ],
  citations: [afp, wang, basis],
  unknownAggregate: { itemised: false, valueCount: 25 },
};

const ctx = { sessionId: 's-1', lastOkAt: new Date('2026-10-06T07:00:00Z') };
const view = (filters: SourcesFilters = NO_FILTERS, tab: 'likelihoods' | 'priors' | 'citations' = 'likelihoods') =>
  toSourcesView(data, filters, tab, ctx);

describe('toSourcesView', () => {
  it('keeps the order the server sent, with no sorting by grade or value', () => {
    expect(view().likelihoods.map((r) => r.conditionName)).toEqual([
      'Acute Pericarditis',
      'Congestive Heart Failure',
    ]);
    expect(view(NO_FILTERS, 'citations').citations.map((c) => c.key)).toEqual([
      'afp_2024',
      'wang_2005',
      'UNKNOWN_BASIS',
    ]);
  });

  it('shows rows as recorded, with registry wording for the finding', () => {
    const row = view().likelihoods[0]!;
    expect(row.findingLabel).toBe('Is a pericardial friction rub present on auscultation?');
    expect(row.lrLabel).toBe('6.5');
    expect(row.derivedLabel).toBe('0.4 / 0.94 / 1');
    expect(row.gradeLabel).toBe('Grade C');
    expect(row.detail!.doiLabel).toBe('to_verify');
  });

  it('filters by condition using the names the server sent', () => {
    const v = view({ ...NO_FILTERS, conditions: new Set(['CONGESTIVE_HEART_FAILURE']) });
    expect(v.likelihoods).toHaveLength(1);
    expect(v.conditionChips.map((c) => c.label)).toEqual(['Acute Pericarditis', 'Congestive Heart Failure']);
    expect(v.conditionChips.find((c) => c.selected)!.value).toBe('CONGESTIVE_HEART_FAILURE');
  });

  it('shows grade C and D exactly as it shows A and B', () => {
    const v = view({ ...NO_FILTERS, grades: new Set(['C']) });
    expect(v.likelihoods.map((r) => r.gradeLabel)).toEqual(['Grade C']);
    expect(v.gradeChips.map((c) => c.value)).toEqual(['A', 'B', 'C', 'D']);
    expect(view(NO_FILTERS, 'citations').citations.map((c) => c.detail.gradeLabel)).toContain('Grade D');
  });

  it('searches case-insensitively with every term required', () => {
    expect(view({ ...NO_FILTERS, query: 'FRICTION rub' }).likelihoods).toHaveLength(1);
    expect(view({ ...NO_FILTERS, query: 'friction wang' }).likelihoods).toHaveLength(0);
    expect(view({ ...NO_FILTERS, query: 'wang' }).likelihoods).toHaveLength(1);
  });

  it('counts what is shown against what exists', () => {
    expect(view().countLabel).toBe('Showing 2 of 2 rows');
    expect(view({ ...NO_FILTERS, query: 'wang' }).countLabel).toBe('Showing 1 of 2 rows');
    expect(view(NO_FILTERS, 'citations').countLabel).toBe('Showing 3 of 3 sources');
  });

  it('describes the citations behind Unknown without naming anything', () => {
    const basisRow = view(NO_FILTERS, 'citations').citations.find((c) => c.key === 'UNKNOWN_BASIS')!;
    expect(basisRow.detail.citedBy).toEqual(['Unknown (values not itemised)']);
    expect(basisRow.detail.yearLabel).toBe('Not recorded');
    expect(basisRow.detail.doiLabel).toBe('Not recorded');
    expect(view().unknownNote).toContain('25 values');
  });

  it('links in-page and builds the back link from the session id', () => {
    expect(view().likelihoods[0]!.citation!.href).toBe('#afp_2024');
    expect(view().header.backHref).toBe('/session/s-1/active');
    const none = toSourcesView(data, NO_FILTERS, 'likelihoods', { ...ctx, sessionId: null });
    expect(none.header.backHref).toBe('/intake');
  });

  it('abbreviates the pack hash', () => {
    expect(view().header.packLabel).toBe('Pack 2026.10.05.0 · sha256:51af…ed5f');
  });

  it('names no hidden condition', () => {
    expect(JSON.stringify(view(NO_FILTERS, 'citations'))).not.toMatch(/shadow/i);
  });
});

describe('toggled', () => {
  it('adds and removes without changing the original set', () => {
    const a: ReadonlySet<string> = new Set(['A']);
    const b = toggled(a, 'B');
    expect([...b].sort()).toEqual(['A', 'B']);
    expect([...a]).toEqual(['A']);
    expect([...toggled(b, 'A')]).toEqual(['B']);
  });
});