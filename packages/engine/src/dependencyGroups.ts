/**
 * Dependency-group redundancy discount, per CDS-CV-FOUNDATION-SPEC-v1.0 §1.3.
 *
 * Naive Bayes assumes conditional independence — but clinical findings don't
 * satisfy that: pleuritic pain, sharp pain, and worse-on-inspiration are
 * nearly synonymous. Without correction, correlated features multiply their
 * weight in the posterior, producing false confidence.
 *
 * The discount mechanism:
 *   1. Group features by their dependency_group (e.g., PLEURITIC_CLUSTER).
 *   2. Within each group, for each condition, apply the feature with the
 *      largest |log-LR| at full strength.
 *   3. Apply each subsequent member at fractional weight λ (default 0.35).
 *   4. This is crude but beats pretending the problem doesn't exist.
 */

export interface FeatureContribution {
  featureId: string;
  rawLogLr: number;
  dependencyGroup: string | null;
  applied: boolean; // whether this feature will be used in the final sum
  appliedWeight: number; // 1.0 for first in group, λ for subsequent
  appliedLogLr: number; // rawLogLr * appliedWeight
  discountReason?: string; // why weight < 1.0
}

export interface DependencyGroupDiscount {
  groupId: string;
  redundancyLambda: number;
  features: FeatureContribution[];
  rationale: string;
}

interface Feature {
  featureId: string;
  rawLogLr: number;
  dependencyGroup: string | null;
}

interface GroupState {
  features: Feature[];
  maxAbsIndex: number;
  lambda: number;
  rationale: string;
}

/**
 * Apply dependency-group redundancy discounts to a set of features for one
 * condition. Groups features by dependency_group, applies the largest
 * |log-LR| in each group at full weight, applies rest at λ fraction.
 *
 * Returns the discounted contributions in the same order as input (for
 * trace-logging), plus a summary of each group's decisions.
 */
export function applyDependencyGroupDiscounts(
  features: Array<{
    featureId: string;
    rawLogLr: number;
    dependencyGroup: string | null;
  }>,
  groupConfigs: Record<string, { redundancyLambda: number; rationale: string }> = {},
): {
  contributions: FeatureContribution[];
  groups: DependencyGroupDiscount[];
} {
  const defaultLambda = 0.35;

  // Group features by dependency_group, tracking which has largest |log-LR|.
  const groups = new Map<string, GroupState>();

  for (const feature of features) {
    const groupId = feature.dependencyGroup || `__standalone_${feature.featureId}`;
    if (!groups.has(groupId)) {
      const config = groupConfigs[groupId] ?? { redundancyLambda: defaultLambda, rationale: "" };
      groups.set(groupId, {
        features: [],
        maxAbsIndex: -1,
        lambda: config.redundancyLambda,
        rationale: config.rationale,
      });
    }

    const group = groups.get(groupId)!;
    const idx = group.features.length;
    group.features.push(feature);

    // Track index of largest |log-LR| in this group.
    if (
      group.maxAbsIndex === -1 ||
      Math.abs(feature.rawLogLr) > Math.abs(group.features[group.maxAbsIndex]!.rawLogLr)
    ) {
      group.maxAbsIndex = idx;
    }
  }

  // Build contributions with weights applied.
  const contributions: FeatureContribution[] = [];
  const groupSummaries: DependencyGroupDiscount[] = [];

  for (const [groupId, group] of groups) {
    const groupContribs: FeatureContribution[] = [];

    for (let i = 0; i < group.features.length; i++) {
      const feature = group.features[i]!;
      const isMaxInGroup = i === group.maxAbsIndex;
      const weight = isMaxInGroup ? 1.0 : group.lambda;
      const appliedLogLr = feature.rawLogLr * weight;

      const contrib: FeatureContribution = {
        featureId: feature.featureId,
        rawLogLr: feature.rawLogLr,
        dependencyGroup: feature.dependencyGroup,
        applied: true,
        appliedWeight: weight,
        appliedLogLr,
      };

      if (!isMaxInGroup) {
        contrib.discountReason = `redundancy discount (λ=${group.lambda}) in group ${groupId}`;
      }

      groupContribs.push(contrib);
      contributions.push(contrib);
    }

    groupSummaries.push({
      groupId: groupId === `__standalone_${group.features[0]!.featureId}` ? "" : groupId,
      redundancyLambda: group.lambda,
      features: groupContribs,
      rationale: group.rationale,
    });
  }

  return { contributions, groups: groupSummaries };
}