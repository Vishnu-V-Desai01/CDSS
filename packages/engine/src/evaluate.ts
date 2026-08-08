/**
 * Core inference engine: evaluate() — the pure function that everything depends on.
 * Per spec §2.1, this is stateless: evidence_set in, result out, no accumulated state.
 *
 * Takes:
 *   - A loaded knowledge pack (conditions with priors, features, profiles)
 *   - Patient info (age, sex, pregnancy status)
 *   - Care setting (determines which prior to use)
 *   - Observed evidence (feature_id -> state mappings)
 *
 * Returns:
 *   - Log-odds and probabilities for all 9 hypotheses
 *   - Fit score for each candidate
 *   - Top contributors to belief for each hypothesis
 */

import { probToLogOdds } from "./logOdds.js";
import { applyEvidenceSet } from "./logOdds.js";
import { applyDependencyGroupDiscounts } from "./dependencyGroups.js";
import { normalise } from "./normalisation.js";
import { computeFitScore } from "./fitScore.js";

export interface EvaluateInput {
  conditions: Array<{
    id: string;
    priors: Record<string, number>; // care_setting -> weight
    features: Array<{
      id: string;
      dependencyGroup: string | null;
      lrs: Record<string, number>; // state -> log-likelihood-ratio
    }>;
    expectedProfile: Array<{
      featureId: string;
      expectedStates: string[];
      weight: number;
      hallmark: boolean;
    }>;
    dependencyGroups: Record<string, { redundancyLambda: number; rationale: string }>;
  }>;
  careSetting: string;
  evidence: Record<string, string>; // feature_id -> observed state
}

export interface TopContributor {
  featureId: string;
  state: string;
  logLrApplied: number;
}

export interface EvaluateResult {
  hypotheses: Array<{
    id: string;
    logOdds: number;
    probability: number;
    fitScore: number | null;
    topContributors: TopContributor[];
  }>;
  normalised: boolean;
}

/**
 * Evaluate evidence against a knowledge pack, producing posterior log-odds
 * and probabilities for all hypotheses.
 *
 * High-level algorithm:
 *   1. Extract priors for the given care_setting, convert to log-odds.
 *   2. For each condition:
 *      a. Collect evidence for features this condition has LRs for.
 *      b. Apply dependency-group discount.
 *      c. Apply the (discounted) evidence set, updating log-odds.
 *      d. Compute fit score against expected profile.
 *   3. Normalise log-odds into probabilities.
 *   4. Return all hypotheses with their beliefs and fit scores.
 */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const { conditions, careSetting, evidence } = input;

  // Step 1: Extract and convert priors to log-odds.
  const priors = new Map<string, number>();
  let totalPriorWeight = 0;

  for (const cond of conditions) {
    const weight = cond.priors[careSetting];
    if (weight === undefined) {
      throw new Error(`Condition ${cond.id} has no prior for care_setting ${careSetting}`);
    }
    priors.set(cond.id, weight);
    totalPriorWeight += weight;
  }

  // Normalise weights and convert to log-odds.
  const priorLogOdds = new Map<string, number>();
  for (const [id, weight] of priors) {
    const prob = weight / totalPriorWeight;
    priorLogOdds.set(id, probToLogOdds(prob));
  }

  // Step 2: For each condition, apply evidence and compute fit score.
  const results = conditions.map((cond) => {
    // Collect LRs for features where we have both:
    //   - An LR defined in this condition for this feature
    //   - Evidence observed for this feature
    const featuresForThisCondition = cond.features
      .filter((f) => evidence[f.id] !== undefined)
      .map((f) => {
        const state = evidence[f.id]!;
        const lr = f.lrs[state];
        if (lr === undefined) {
          throw new Error(
            `Condition ${cond.id}, feature ${f.id}: no LR defined for state ${state}`,
          );
        }
        return {
          featureId: f.id,
          rawLogLr: Math.log(lr),
          dependencyGroup: f.dependencyGroup,
        };
      });

    // Apply dependency-group discount.
    const { contributions } = applyDependencyGroupDiscounts(
      featuresForThisCondition,
      cond.dependencyGroups,
    );

    // Apply the (discounted) evidence set.
    const priorLogOdd = priorLogOdds.get(cond.id)!;
    const evidenceResult = applyEvidenceSet(
      priorLogOdd,
      contributions.map((c) => ({ label: c.featureId, rawLogLr: c.appliedLogLr })),
    );

    // Compute fit score.
    const fitResult = computeFitScore(cond.expectedProfile, evidence);

    // Top contributors: the largest |log-LR| applied features.
    const topContributors: TopContributor[] = contributions
      .sort((a, b) => Math.abs(b.appliedLogLr) - Math.abs(a.appliedLogLr))
      .slice(0, 5)
      .map((c) => ({
        featureId: c.featureId,
        state: evidence[c.featureId]!,
        logLrApplied: c.appliedLogLr,
      }));

    return {
      id: cond.id,
      logOdds: evidenceResult.logOddsAfter,
      fitScore: fitResult.score,
      topContributors,
    };
  });

  // Step 3: Normalise log-odds into probabilities.
  const normResult = normalise(results.map((r) => ({ id: r.id, logOdds: r.logOdds })));

  // Step 4: Merge results.
  const hypotheses = results.map((r) => {
    const norm = normResult.hypotheses.find((h) => h.id === r.id)!;
    return {
      id: r.id,
      logOdds: r.logOdds,
      probability: norm.probability,
      fitScore: r.fitScore,
      topContributors: r.topContributors,
    };
  });

  return {
    hypotheses,
    normalised: normResult.probabilitySum > 0.9999 && normResult.probabilitySum < 1.0001,
  };
}