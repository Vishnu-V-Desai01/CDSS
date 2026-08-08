/**
 * Fit score: how well does the observed evidence match this condition's
 * expected profile? Per spec §3.4.
 *
 * Fit score is ABSOLUTE (matches reality, not relative to other conditions).
 * A posterior of 0.8 on a condition with fit_score 0.2 is a red flag:
 * the math says this is likely, but the observation doesn't match what
 * this condition usually looks like.
 */

export interface ProfileEntry {
  featureId: string;
  expectedStates: string[]; // states that count as concordant
  weight: number;
  hallmark: boolean; // if true and observed state is NOT expected, apply 0.5x penalty
}

export interface FitScoreResult {
  score: number | null; // null if insufficient observations
  status: "SUFFICIENT" | "INSUFFICIENT_OBSERVATIONS";
  concordant: number;
  discordant: number;
  observedWeight: number;
  totalProfileWeight: number;
  hallmarkPenaltyApplied: number;
}

/**
 * Compute fit score for one condition given the observed evidence states.
 *
 * Logic (spec §3.4):
 *   - concordant = sum of profile weights where observed state matches expected
 *   - discordant = sum of profile weights where state is observed but NOT expected
 *   - observed_weight = sum of weights for any observed state (expected or not)
 *   - fit_raw = (concordant - discordant) / observed_weight
 *   - hallmark_penalty = 0.5 for each hallmark entry observed but discordant
 *   - fit_score = clamp(fit_raw, 0, 1) × Π(hallmark_penalty)
 *
 * If observed_weight < 30% of total, return null (insufficient info).
 */
export function computeFitScore(
  profile: ProfileEntry[],
  observedStates: Record<string, string | null>, // feature_id -> observed state or null
): FitScoreResult {
  let concordant = 0;
  let discordant = 0;
  let observedWeight = 0;
  let hallmarkPenalty = 1.0;

  for (const entry of profile) {
    const observed = observedStates[entry.featureId];
    if (!observed) continue; // not observed, skip

    observedWeight += entry.weight;

    const isExpected = entry.expectedStates.includes(observed);
    if (isExpected) {
      concordant += entry.weight;
    } else {
      discordant += entry.weight;
      if (entry.hallmark) {
        hallmarkPenalty *= 0.5; // multiplicative penalty per hallmark
      }
    }
  }

  const totalProfileWeight = profile.reduce((sum, e) => sum + e.weight, 0);
  const coverageRatio = totalProfileWeight > 0 ? observedWeight / totalProfileWeight : 0;

  if (coverageRatio < 0.3) {
    return {
      score: null,
      status: "INSUFFICIENT_OBSERVATIONS",
      concordant,
      discordant,
      observedWeight,
      totalProfileWeight,
      hallmarkPenaltyApplied: 1.0,
    };
  }

  const fitRaw = observedWeight > 0 ? (concordant - discordant) / observedWeight : 0;
  const fitClamped = Math.max(0, Math.min(1, fitRaw));
  const score = fitClamped * hallmarkPenalty;

  return {
    score,
    status: "SUFFICIENT",
    concordant,
    discordant,
    observedWeight,
    totalProfileWeight,
    hallmarkPenaltyApplied: hallmarkPenalty,
  };
}