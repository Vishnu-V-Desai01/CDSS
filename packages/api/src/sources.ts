// packages/api/src/sources.ts
/**
 * /sources endpoint generation.
 *
 * Per Chat 3 contract: this is the artifact an examiner uses to spot-check
 * the project. Generated from the built pack, never hand-maintained.
 *
 * SCOPE RULE: only the four reportable conditions are itemised. The shadow
 * conditions are modelled internally and reported only as the aggregated
 * UNKNOWN, so their values, ids and display names never leave the server.
 * Citations that support ONLY those hidden values are collapsed into a single
 * UNKNOWN_BASIS entry (see publicCitations.ts), so a trace link behind the
 * UNKNOWN probability still resolves without naming anything.
 */

import { CANDIDATE_IDS } from "@cds/shared-types";
import type { LoadedPack } from "./packLoader.js";
import { buildPublicCitationMap, UNKNOWN_BASIS_ID } from "./publicCitations.js";

const IN_SCOPE: ReadonlySet<string> = new Set<string>(CANDIDATE_IDS);

export interface CitationDetail {
  id: string;
  type: string;
  title: string;
  authors: string;
  /** Null only for the collapsed UNKNOWN_BASIS entry. */
  year: number | null;
  doi: string | null;
  pmid: string | null;
  evidenceGrade: string;
  tableOrFigure: string;
  notes: string | null;
}

export interface SourceEntry {
  conditionId: string;
  conditionDisplayName: string;
  featureId: string;
  /** Question wording from the features registry, so rows read as words and not ids. */
  featurePrompt: string | null;
  state: string;
  lr: number;
  tier: string;
  acquisitionCost: number;
  invasiveness: string;
  dependencyGroup: string | null;
  verificationStatus: string;
  derivedFrom: {
    sensitivity: number;
    specificity: number;
    n: number;
    prevalenceInStudy: number;
  } | null;
  /** Null only when the pack carries no citation (the LR is then 1.0). */
  citation: CitationDetail | null;
}

export interface PriorSourceEntry {
  conditionId: string;
  conditionDisplayName: string;
  careSetting: string;
  weight: number;
  /** Population the prior was drawn from, as recorded in the pack. */
  population: string;
  verificationStatus: string;
  citation: CitationDetail | null;
}

export interface CitationIndexEntry extends CitationDetail {
  /** In-scope condition ids that cite this source. Never a hidden id. */
  usedBy: string[];
  /** True when a value inside the UNKNOWN aggregate cites this source. */
  usedInUnknownAggregate: boolean;
}

export interface UnknownAggregateInfo {
  itemised: false;
  /** Number of LR and prior values behind UNKNOWN that are not itemised. */
  valueCount: number;
}

export interface SourcesResponse {
  knowledgePackVersion: string;
  knowledgePackHash: string;
  generatedAt: string;
  featureLikelihoods: SourceEntry[];
  priors: PriorSourceEntry[];
  citations: CitationIndexEntry[];
  unknownAggregate: UnknownAggregateInfo;
}

interface CitationUse {
  usedBy: Set<string>;
  usedInUnknown: boolean;
}

function describeCitation(pack: LoadedPack, id: string | null): CitationDetail | null {
  if (!id) return null;
  const c = pack.citations[id];
  if (!c) return null;
  return {
    id,
    type: c.type,
    title: c.title,
    authors: c.authors,
    year: c.year,
    doi: c.doi ?? null,
    pmid: c.pmid ?? null,
    evidenceGrade: c.evidence_grade,
    tableOrFigure: c.table_or_figure,
    notes: c.notes ?? null,
  };
}

/** Worst (lowest) recorded grade; A is best, D is worst. Unknown counts as D. */
function lowestGrade(grades: string[]): string {
  if (grades.length === 0) return "D";
  return grades.reduce((worst, g) => (g > worst ? g : worst), "A");
}

export function buildSourcesResponse(pack: LoadedPack): SourcesResponse {
  const citationMap = buildPublicCitationMap(pack);
  const featureLikelihoods: SourceEntry[] = [];
  const priors: PriorSourceEntry[] = [];
  const uses = new Map<string, CitationUse>();
  let withheldValues = 0;

  function noteUse(citationId: string | null, conditionId: string, inScope: boolean): void {
    // Withheld citations are represented by the single UNKNOWN_BASIS entry.
    if (!citationId || citationMap.withheldIds.has(citationId)) return;
    let use = uses.get(citationId);
    if (!use) {
      use = { usedBy: new Set<string>(), usedInUnknown: false };
      uses.set(citationId, use);
    }
    if (inScope) use.usedBy.add(conditionId);
    else use.usedInUnknown = true;
  }

  for (const condition of Object.values(pack.conditions)) {
    const inScope = IN_SCOPE.has(condition.condition_id);

    for (const [careSetting, priorEntry] of Object.entries(condition.priors)) {
      if (!priorEntry) continue;
      noteUse(priorEntry.citation_id, condition.condition_id, inScope);
      if (!inScope) {
        withheldValues += 1;
        continue;
      }
      priors.push({
        conditionId: condition.condition_id,
        conditionDisplayName: condition.display_name,
        careSetting,
        weight: priorEntry.weight,
        population: priorEntry.population,
        verificationStatus: priorEntry.verification_status,
        citation: describeCitation(pack, priorEntry.citation_id),
      });
    }

    for (const feature of condition.features) {
      for (const state of feature.states) {
        noteUse(state.citation_id, condition.condition_id, inScope);
        if (!inScope) {
          withheldValues += 1;
          continue;
        }
        featureLikelihoods.push({
          conditionId: condition.condition_id,
          conditionDisplayName: condition.display_name,
          featureId: feature.feature_id,
          featurePrompt: pack.featuresRegistry[feature.feature_id]?.prompt ?? null,
          state: state.value,
          lr: state.lr,
          tier: feature.tier,
          acquisitionCost: feature.acquisition_cost,
          invasiveness: feature.invasiveness,
          dependencyGroup: feature.dependency_group,
          verificationStatus: feature.verification_status,
          derivedFrom: state.derived_from
            ? {
                sensitivity: state.derived_from.sensitivity,
                specificity: state.derived_from.specificity,
                n: state.derived_from.n,
                prevalenceInStudy: state.derived_from.prevalence_in_study,
              }
            : null,
          citation: describeCitation(pack, state.citation_id),
        });
      }
    }
  }

  // Deterministic ordering: condition, then feature, then state.
  featureLikelihoods.sort((a, b) => {
    const c = a.conditionId.localeCompare(b.conditionId);
    if (c !== 0) return c;
    const f = a.featureId.localeCompare(b.featureId);
    if (f !== 0) return f;
    return a.state.localeCompare(b.state);
  });

  priors.sort((a, b) => {
    const c = a.conditionId.localeCompare(b.conditionId);
    if (c !== 0) return c;
    return a.careSetting.localeCompare(b.careSetting);
  });

  const citations: CitationIndexEntry[] = [];
  for (const [id, use] of uses) {
    const detail = describeCitation(pack, id);
    if (!detail) continue;
    citations.push({
      ...detail,
      usedBy: [...use.usedBy].sort(),
      usedInUnknownAggregate: use.usedInUnknown,
    });
  }

  // One neutral entry for every source that supports only the UNKNOWN
  // aggregate. Its grade is the lowest recorded among them, so weak evidence
  // is never presented as stronger than it is.
  if (citationMap.withheldIds.size > 0) {
    const grades = [...citationMap.withheldIds].map(
      (id) => pack.citations[id]?.evidence_grade ?? "D"
    );
    citations.push({
      id: UNKNOWN_BASIS_ID,
      type: "NOT_ITEMISED",
      title: "Basis for the Unknown aggregate (not itemised)",
      authors: "Cardiac CDS project",
      year: null,
      doi: null,
      pmid: null,
      evidenceGrade: lowestGrade(grades),
      tableOrFigure: "Not itemised",
      notes:
        `Sources that support only the Unknown aggregate are not listed ` +
        `individually (${citationMap.withheldIds.size} withheld). ` +
        `The grade shown is the lowest recorded among them.`,
      usedBy: [],
      usedInUnknownAggregate: true,
    });
  }

  citations.sort((a, b) => a.id.localeCompare(b.id));

  return {
    knowledgePackVersion: pack.knowledgePackVersion,
    knowledgePackHash: pack.knowledgePackHash,
    generatedAt: new Date().toISOString(),
    featureLikelihoods,
    priors,
    citations,
    unknownAggregate: { itemised: false, valueCount: withheldValues },
  };
}