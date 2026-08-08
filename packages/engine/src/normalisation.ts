/**
 * Normalisation: convert log-odds to probabilities, per spec §2.4.
 *
 * The engine works in log-odds space internally (addition, clamping).
 * At reporting time, convert to probabilities that sum to exactly 1.0.
 *
 * Implementation: softmax over log-odds (numerically stable form).
 */

import { logOddsToProb } from "./logOdds.js";

export interface HypothesisOdds {
  id: string;
  logOdds: number;
}

export interface NormalisedResult {
  hypotheses: Array<{
    id: string;
    logOdds: number;
    probability: number;
  }>;
  /** Sum of all probabilities — should be 1.0000 ± 1e-6 for valid output. */
  probabilitySum: number;
}

/**
 * Normalise a set of log-odds into probabilities that sum to 1.0.
 *
 * Standard softmax operation over log-odds, implemented in the
 * numerically-stable log-sum-exp form to avoid overflow/underflow:
 *
 *   1. Find the maximum log-odds value (for numerical stability).
 *   2. Compute exp(logOdds[i] - max_logOdds) for each (stable subtraction).
 *   3. Sum those exps to get the partition function Z.
 *   4. Probability[i] = exp(logOdds[i] - max_logOdds) / Z.
 *
 * This is mathematically identical to the naive softmax but doesn't
 * overflow or underflow, even with wildly different log-odds values.
 */
export function normalise(hypotheses: HypothesisOdds[]): NormalisedResult {
  if (hypotheses.length === 0) {
    throw new Error("normalise: at least one hypothesis required");
  }

  // Step 1: find max log-odds for numerical stability
  const maxLogOdds = Math.max(...hypotheses.map((h) => h.logOdds));

  // Step 2: compute unnormalised probabilities (exp with stable subtraction)
  const unnormalised = hypotheses.map((h) => ({
    id: h.id,
    logOdds: h.logOdds,
    exp: Math.exp(h.logOdds - maxLogOdds),
  }));

  // Step 3: partition function (sum of exps)
  const partitionFunction = unnormalised.reduce((sum, u) => sum + u.exp, 0);

  // Step 4: normalise
  const result = unnormalised.map((u) => ({
    id: u.id,
    logOdds: u.logOdds,
    probability: u.exp / partitionFunction,
  }));

  const probabilitySum = result.reduce((sum, r) => sum + r.probability, 0);

  return { hypotheses: result, probabilitySum };
}

/**
 * Sanity check: verify that normalised probabilities actually sum to 1.0
 * within floating-point tolerance.
 */
export function checkNormalisation(result: NormalisedResult, tolerance: number = 1e-6): boolean {
  return Math.abs(result.probabilitySum - 1.0) <= tolerance;
}