/**
 * Expected information gain for candidate questions.
 *
 * THE IDENTIFICATION PROBLEM
 * --------------------------
 * The knowledge pack stores likelihood ratios. An LR is a ratio, so it tells us
 * how much an answer moves belief but not how likely that answer is. Ranking
 * questions needs both: a question whose informative answer almost never occurs
 * is a bad question.
 *
 * For a BINARY feature, P(state | hypothesis) is exactly recoverable from the
 * LR pair. With sensitivity s and specificity p for hypothesis h:
 *
 *     LR_A = s / (1 - p)        LR_B = (1 - s) / p
 *
 * Solving:
 *
 *     p = (LR_A - 1) / (LR_A - LR_B)
 *     s = LR_A * (1 - p)
 *
 * This is algebra on the pack's own numbers, not a new assumption. It has a
 * valid solution only when LR_B < 1 < LR_A (or the mirror image). LR pairs
 * pooled independently from meta-analyses can violate this; when they do we
 * fall back to the approximation below and flag it, which also makes the
 * incoherence visible to whoever reads the trace.
 *
 * For a MULTI-STATE feature (Wells strata, Geneva strata) the system is
 * under-determined: k states give k equations against 2k-2 unknowns. We assume
 * a uniform background distribution over states in the not-h class, giving
 * P(state | h) proportional to LR_state, and mark the result APPROXIMATE.
 *
 * TWO DIFFERENT PREDICTIONS
 * -------------------------
 * Predicting which ANSWER arrives uses the inverted P(state | h).
 * Predicting how far BELIEF MOVES replays the engine's actual update rule
 * (add log-LR per hypothesis, then normalise). These are not the same
 * operation, and deliberately so: the ranker must predict what evaluate()
 * will really do, not what an idealised joint model would do.
 */

import { normalise } from "./normalisation.js";

export type LikelihoodMethod =
  | "EXACT_BINARY"
  | "APPROXIMATE_UNIFORM_BACKGROUND";

/** log-LRs for one hypothesis across every state of one feature. */
export interface HypothesisStateLogLrs {
  hypothesisId: string;
  /** state -> log-likelihood-ratio, matching EvaluateInput.features[].lrs */
  logLrs: Record<string, number>;
}

export interface StateLikelihoods {
  /** state -> P(state | hypothesis). Sums to 1. */
  probabilities: Record<string, number>;
  method: LikelihoodMethod;
}

export interface EigResult {
  featureId: string;
  /** Expected information gain in bits. Always >= 0. */
  eigBits: number;
  /** Entropy of the current posterior, in bits. EIG can never exceed this. */
  currentEntropyBits: number;
  /** Predictive probability of each answer, marginal over hypotheses. */
  predictedStateProbabilities: Record<string, number>;
  /**
   * EXACT_BINARY only when every hypothesis inverted exactly. A single
   * approximate or incoherent hypothesis degrades the whole result, because
   * the predictive mixture is only as sound as its weakest component.
   */
  method: LikelihoodMethod;
  /** Hypotheses whose LR pair could not be inverted. Empty in the clean case. */
  incoherentHypotheses: string[];
}

const LOG2 = Math.log(2);

/** Shannon entropy in bits. Zero-probability terms contribute nothing. */
export function entropyBits(probabilities: readonly number[]): number {
  let h = 0;
  for (const p of probabilities) {
    if (p > 0) h -= p * (Math.log(p) / LOG2);
  }
  return h;
}

export interface InvertedOperatingPoint {
  sensitivity: number;
  specificity: number;
}

/**
 * Recover sensitivity and specificity from a binary LR pair.
 * Returns null when the pair admits no valid operating point, which means the
 * two LRs are mutually inconsistent and one of them is wrong.
 *
 * `lrA` is the LR for the state whose P(state | h) is returned as sensitivity.
 */
export function invertBinaryLikelihoodRatios(
  lrA: number,
  lrB: number
): InvertedOperatingPoint | null {
  const denominator = lrA - lrB;
  if (Math.abs(denominator) < 1e-12) return null; // uninformative or identical

  const specificity = (lrA - 1) / denominator;
  const sensitivity = lrA * (1 - specificity);

  const inRange = (x: number) => x > 0 && x < 1;
  if (!inRange(specificity) || !inRange(sensitivity)) return null;

  return { sensitivity, specificity };
}

/**
 * P(state | hypothesis) for every state of one feature, for one hypothesis.
 * Exact for coherent binary features, approximate otherwise.
 */
export function stateLikelihoods(
  logLrs: Record<string, number>
): StateLikelihoods {
  const states = Object.keys(logLrs).sort(); // deterministic ordering
  if (states.length === 0) {
    return { probabilities: {}, method: "APPROXIMATE_UNIFORM_BACKGROUND" };
  }

  if (states.length === 2) {
    const [a, b] = states as [string, string];
    const inverted = invertBinaryLikelihoodRatios(
      Math.exp(logLrs[a]!),
      Math.exp(logLrs[b]!)
    );
    if (inverted) {
      return {
        probabilities: {
          [a]: inverted.sensitivity,
          [b]: 1 - inverted.sensitivity,
        },
        method: "EXACT_BINARY",
      };
    }
  }

  // Uniform-background fallback: P(state | h) proportional to LR_state.
  const lrs = states.map((s) => Math.exp(logLrs[s]!));
  const total = lrs.reduce((acc, x) => acc + x, 0);
  const probabilities: Record<string, number> = {};
  states.forEach((s, i) => {
    probabilities[s] = total > 0 ? lrs[i]! / total : 1 / states.length;
  });

  return { probabilities, method: "APPROXIMATE_UNIFORM_BACKGROUND" };
}

export interface EigInput {
  featureId: string;
  /** Current belief state, straight from evaluate(). */
  currentLogOdds: Array<{ id: string; logOdds: number }>;
  /** The candidate feature's log-LRs, per hypothesis. */
  hypothesisLogLrs: HypothesisStateLogLrs[];
}

/**
 * Expected reduction in posterior entropy from asking one question.
 *
 *     EIG = H(current) - SUM_state P(state) * H(posterior | state)
 */
export function expectedInformationGain(input: EigInput): EigResult {
  const { featureId, currentLogOdds, hypothesisLogLrs } = input;

  // Deterministic ordering everywhere.
  const hypotheses = [...currentLogOdds].sort((x, y) => x.id.localeCompare(y.id));
  const lrByHypothesis = new Map(
    hypothesisLogLrs.map((h) => [h.hypothesisId, h.logLrs])
  );

  const current = normalise(hypotheses);
  const currentProbById = new Map(
    current.hypotheses.map((h) => [h.id, h.probability])
  );
  const currentEntropyBits = entropyBits(
    hypotheses.map((h) => currentProbById.get(h.id) ?? 0)
  );

  // Every state mentioned by any hypothesis, sorted.
  const allStates = [
    ...new Set(hypothesisLogLrs.flatMap((h) => Object.keys(h.logLrs))),
  ].sort();

  if (allStates.length === 0) {
    return {
      featureId,
      eigBits: 0,
      currentEntropyBits,
      predictedStateProbabilities: {},
      method: "APPROXIMATE_UNIFORM_BACKGROUND",
      incoherentHypotheses: [],
    };
  }

  // Per-hypothesis P(state | h), tracking inversion quality.
  const incoherentHypotheses: string[] = [];
  const likelihoodByHypothesis = new Map<string, Record<string, number>>();

  for (const h of hypotheses) {
    const logLrs = lrByHypothesis.get(h.id);
    if (!logLrs || Object.keys(logLrs).length === 0) {
      // Feature carries no evidence for this hypothesis: uninformative,
      // so its answer distribution is flat and it never moves belief.
      const flat: Record<string, number> = {};
      for (const s of allStates) flat[s] = 1 / allStates.length;
      likelihoodByHypothesis.set(h.id, flat);
      continue;
    }

    const { probabilities, method } = stateLikelihoods(logLrs);
    if (method === "APPROXIMATE_UNIFORM_BACKGROUND") {
      incoherentHypotheses.push(h.id);
    }
    likelihoodByHypothesis.set(h.id, probabilities);
  }

  // Predictive P(state) = SUM_h P(h) * P(state | h).
  const predictedStateProbabilities: Record<string, number> = {};
  for (const s of allStates) {
    let p = 0;
    for (const h of hypotheses) {
      const prior = currentProbById.get(h.id) ?? 0;
      p += prior * (likelihoodByHypothesis.get(h.id)?.[s] ?? 0);
    }
    predictedStateProbabilities[s] = p;
  }

  // Expected posterior entropy, replaying the engine's own update rule.
  let expectedEntropy = 0;
  for (const s of allStates) {
    const pState = predictedStateProbabilities[s]!;
    if (pState <= 0) continue;

    const updated = hypotheses.map((h) => ({
      id: h.id,
      logOdds: h.logOdds + (lrByHypothesis.get(h.id)?.[s] ?? 0),
    }));
    const posterior = normalise(updated);
    expectedEntropy +=
      pState * entropyBits(posterior.hypotheses.map((h) => h.probability));
  }

  // Clamp at zero: EIG is non-negative in exact arithmetic, and only floating
  // point noise can push it below.
  const eigBits = Math.max(0, currentEntropyBits - expectedEntropy);

  return {
    featureId,
    eigBits,
    currentEntropyBits,
    predictedStateProbabilities,
    method:
      incoherentHypotheses.length === 0
        ? "EXACT_BINARY"
        : "APPROXIMATE_UNIFORM_BACKGROUND",
    incoherentHypotheses,
  };
}