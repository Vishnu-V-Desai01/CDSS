/**
 * Adapter: compiled pack.json (Chat 1's ConditionFile shape) -> the input
 * shapes evaluate() and the ranker actually consume.
 *
 * THREE STRUCTURAL FOLDS, NOT RENAMES
 * ------------------------------------
 * 1. states: FeatureState[] -> lrs: Record<state, lr>. An array-to-map fold.
 *    lr values are RAW ratios in the pack (confirmed: PERC_RULE NEGATIVE
 *    lr: 0.17, POSITIVE lr: 1.28) and evaluate() takes Math.log(lr)
 *    internally, so raw values pass through unchanged here.
 * 2. priors: Partial<Record<CareSetting, PriorEntry>> -> Record<string,
 *    number>. PriorEntry wraps the number in {weight, citation_id,
 *    population, verification_status}; evaluate() wants the bare weight.
 * 3. dependency_groups: DependencyGroup[] -> Record<group_id, {...}>.
 *
 * COST HAS NO REGISTRY-LEVEL HOME
 * --------------------------------
 * features.registry.yaml carries tier but NOT acquisition_cost — cost lives
 * on ConditionFeature, per condition. Chat 1's crossChecks already guarantees
 * every condition's tier matches the registry, so tier is safe to read from
 * either place. Cost has no other source of truth, so buildFeatureMetaFromPack
 * derives it directly from the condition files and enforces that the same
 * feature never carries two different costs across conditions — the same
 * blood test can't cost a different amount depending on which diagnosis is
 * under consideration.
 */

import type {
  ConditionFile,
  ConditionFeature,
  DependencyGroup,
  ExpectedProfileEntry,
  PriorEntry,
} from "@cds/shared-types";
import type { EvaluateInput } from "./evaluate.js";
import type { EvidenceTier } from "./rankQuestions.js";

export interface AdaptedFeatureMeta {
  tier: EvidenceTier;
  cost: number;
}

/**
 * Hoisted rather than written inline as a multi-line Record<string, {...}>
 * annotation: a generic type spanning several lines in a variable
 * declaration has repeatedly proven fragile in this pipeline (same class of
 * issue as the earlier session.ts parse desync). A named alias sidesteps it.
 */
type DependencyGroupMeta = { redundancyLambda: number; rationale: string };

export class InconsistentFeatureMetaError extends Error {
  constructor(
    featureId: string,
    existing: AdaptedFeatureMeta,
    conflicting: AdaptedFeatureMeta,
    conditionId: string
  ) {
    super(
      `Feature "${featureId}" has tier/cost (${existing.tier}, ${existing.cost}) ` +
        `elsewhere in the pack but (${conflicting.tier}, ${conflicting.cost}) in ` +
        `condition "${conditionId}". Acquisition cost and tier must be identical ` +
        `everywhere a feature appears.`
    );
    this.name = "InconsistentFeatureMetaError";
  }
}

/** Convert one compiled ConditionFile into evaluate()'s expected shape. */
export function adaptConditionFile(
  file: ConditionFile
): EvaluateInput["conditions"][number] {
  const priors: Record<string, number> = {};
  for (const [careSetting, entry] of Object.entries(file.priors)) {
    if (entry) priors[careSetting] = (entry as PriorEntry).weight;
  }

  const features = file.features.map((f: ConditionFeature) => {
    const lrs: Record<string, number> = {};
    for (const state of f.states) {
      lrs[state.value] = state.lr;
    }
    return {
      id: f.feature_id,
      dependencyGroup: f.dependency_group,
      lrs,
    };
  });

  const expectedProfile = file.expected_profile.map((p: ExpectedProfileEntry) => ({
    featureId: p.feature_id,
    expectedStates: Array.isArray(p.expected_state)
      ? p.expected_state
      : [p.expected_state],
    weight: p.weight,
    hallmark: p.hallmark,
  }));

  const dependencyGroups: Record<string, DependencyGroupMeta> = {};
  for (const g of file.dependency_groups as DependencyGroup[]) {
    dependencyGroups[g.group_id] = {
      redundancyLambda: g.redundancy_lambda,
      rationale: g.rationale,
    };
  }

  return {
    id: file.condition_id,
    priors,
    features,
    expectedProfile,
    dependencyGroups,
  };
}

/**
 * Adapt every condition in a compiled pack. Sorted by condition_id for
 * determinism — evaluate() doesn't care about array order, but a stable
 * order makes debugging and trace comparison predictable.
 */
export function adaptPack(
  conditions: Record<string, ConditionFile>
): EvaluateInput["conditions"] {
  return Object.values(conditions)
    .sort((a, b) => a.condition_id.localeCompare(b.condition_id))
    .map(adaptConditionFile);
}

/** Derive {tier, cost} for every feature directly from the condition files. */
export function buildFeatureMetaFromPack(
  conditions: Record<string, ConditionFile>
): Record<string, AdaptedFeatureMeta> {
  const meta = new Map<string, AdaptedFeatureMeta & { seenIn: string }>();

  for (const file of Object.values(conditions)) {
    for (const f of file.features) {
      const candidate: AdaptedFeatureMeta = {
        tier: f.tier,
        cost: f.acquisition_cost,
      };
      const existing = meta.get(f.feature_id);
      if (!existing) {
        meta.set(f.feature_id, { ...candidate, seenIn: file.condition_id });
        continue;
      }
      if (existing.tier !== candidate.tier || existing.cost !== candidate.cost) {
        throw new InconsistentFeatureMetaError(
          f.feature_id,
          existing,
          candidate,
          file.condition_id
        );
      }
    }
  }

  const out: Record<string, AdaptedFeatureMeta> = {};
  for (const [id, m] of meta) out[id] = { tier: m.tier, cost: m.cost };
  return out;
}

/**
 * Citation resolution, PER HYPOTHESIS. A feature's citation can legitimately
 * differ between conditions (e.g. PLEURITIC_PAIN's LR for PE may cite a
 * different source than its LR for CHF) — resolving by (featureId, state)
 * alone, ignoring which condition is asking, silently misattributes shared
 * findings. This is the fix for that.
 */
export function buildCitationResolver(
  conditions: Record<string, ConditionFile>
): (featureId: string, state: string, hypothesisId: string) => string | null {
  return (featureId, state, hypothesisId) => {
    const file = conditions[hypothesisId];
    if (!file) return null;
    const feature = file.features.find((f) => f.feature_id === featureId);
    if (!feature) return null;
    const stateEntry = feature.states.find((s) => s.value === state);
    return stateEntry?.citation_id ?? null;
  };
}