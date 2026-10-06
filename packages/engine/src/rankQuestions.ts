/**
 * Question ranker: value-of-information ordering under a hard tier constraint.
 *
 * Value = expected information gain / acquisition cost. Tier constraint then
 * OVERRIDES that ranking: a cheap question in an earlier tier is offered ahead
 * of a more informative one in a later tier, because escalating to imaging
 * before exhausting the history is clinically wrong regardless of what the
 * arithmetic prefers.
 *
 * FOUR TIERS, NOT THREE
 * ----------------------
 * The real pack declares NEAR_BEDSIDE as a distinct tier from BEDSIDE
 * (e.g. D_DIMER_ELFA, BNP) — confirmed against features.registry.yaml. An
 * earlier version of this file assumed near-bedside tests could fold into
 * BEDSIDE at higher cost; that assumption was never checked against real
 * data and was wrong. Tier order now matches shared-types' EVIDENCE_TIERS
 * exactly: HISTORY, BEDSIDE, NEAR_BEDSIDE, IMAGING.
 *
 * TIER EXHAUSTION IS INFORMATIONAL, NOT LITERAL
 * ---------------------------------------------
 * A tier is exhausted when no unanswered, undeferred question in it yields at
 * least `minEigBits`. Requiring literal emptiness would force the clinician
 * through every trivial history question before any test could be suggested.
 * The threshold is explicit and reported so the tier transition is auditable.
 *
 * DEFERRAL DOES NOT HOLD A TIER OPEN
 * ----------------------------------
 * A deferred question leaves the tier gate immediately. Otherwise skipping a
 * bedside question would permanently block imaging — a deadlock caused by the
 * clinician using the deferral feature as designed. Deferred questions keep
 * their impact score in the pending queue and stay answerable.
 */

import {
  expectedInformationGain,
  type HypothesisStateLogLrs,
  type LikelihoodMethod,
} from "./informationGain.js";

export type EvidenceTier = "HISTORY" | "BEDSIDE" | "NEAR_BEDSIDE" | "IMAGING";

/** Ordering is the clinical escalation path. Index is the gate position. */
export const TIER_ORDER: readonly EvidenceTier[] = [
  "HISTORY",
  "BEDSIDE",
  "NEAR_BEDSIDE",
  "IMAGING",
] as const;

export class InvalidCostError extends Error {
  constructor(featureId: string, cost: number) {
    super(
      `Feature "${featureId}" has acquisition cost ${cost}. Cost must be > 0; ` +
        `a zero or negative cost makes value = EIG/cost undefined or infinite.`
    );
    this.name = "InvalidCostError";
  }
}

export interface CandidateQuestion {
  featureId: string;
  tier: EvidenceTier;
  /** acquisition_cost from the pack. Must be > 0. */
  cost: number;
  hypothesisLogLrs: HypothesisStateLogLrs[];
}

export interface RankedQuestion {
  featureId: string;
  tier: EvidenceTier;
  cost: number;
  eigBits: number;
  /** eigBits / cost. The pure value-of-information score. */
  value: number;
  /** True when the tier constraint bars this question for now. */
  gatedOut: boolean;
  method: LikelihoodMethod;
  incoherentHypotheses: string[];
}

export interface RankInput {
  currentLogOdds: Array<{ id: string; logOdds: number }>;
  candidates: CandidateQuestion[];
  /** Features already answered. Never re-offered. */
  answered?: ReadonlySet<string>;
  /** Features the clinician skipped. Scored, but not offered as next. */
  deferred?: ReadonlySet<string>;
  /** A tier is exhausted when nothing in it beats this. Default 0.01 bits. */
  minEigBits?: number;
}

export interface RankResult {
  /** All eligible questions, best first. Includes gated-out ones. */
  ranked: RankedQuestion[];
  /** The single question to ask now, or null when nothing is worth asking. */
  nextQuestion: RankedQuestion | null;
  /** The tier the gate currently permits. */
  activeTier: EvidenceTier | null;
  /** Plain-language account of why the gate sits where it does. */
  tierRationale: string;
  minEigBits: number;
}

const DEFAULT_MIN_EIG_BITS = 0.01;

/**
 * Deterministic total order: value desc, then EIG desc, then id asc.
 * The final key guarantees a unique ordering even under exact ties, so the
 * same inputs always yield the same next question.
 */
function compareRanked(a: RankedQuestion, b: RankedQuestion): number {
  if (b.value !== a.value) return b.value - a.value;
  if (b.eigBits !== a.eigBits) return b.eigBits - a.eigBits;
  return a.featureId.localeCompare(b.featureId);
}

export function rankQuestions(input: RankInput): RankResult {
  const {
    currentLogOdds,
    candidates,
    answered = new Set<string>(),
    deferred = new Set<string>(),
    minEigBits = DEFAULT_MIN_EIG_BITS,
  } = input;

  // Score every unanswered candidate. Deferred questions ARE scored — the
  // pending queue needs their impact — but are excluded from the gate below.
  const eligible = candidates
    .filter((c) => !answered.has(c.featureId))
    .sort((a, b) => a.featureId.localeCompare(b.featureId)); // determinism

  const scored: RankedQuestion[] = eligible.map((c) => {
    if (!(c.cost > 0)) throw new InvalidCostError(c.featureId, c.cost);

    const eig = expectedInformationGain({
      featureId: c.featureId,
      currentLogOdds,
      hypothesisLogLrs: c.hypothesisLogLrs,
    });

    return {
      featureId: c.featureId,
      tier: c.tier,
      cost: c.cost,
      eigBits: eig.eigBits,
      value: eig.eigBits / c.cost,
      gatedOut: true, // provisional; resolved once the active tier is known
      method: eig.method,
      incoherentHypotheses: eig.incoherentHypotheses,
    };
  });

  // Find the earliest tier still carrying real information, ignoring deferrals.
  let activeTier: EvidenceTier | null = null;
  for (const tier of TIER_ORDER) {
    const live = scored.some(
      (q) =>
        q.tier === tier &&
        !deferred.has(q.featureId) &&
        q.eigBits >= minEigBits
    );
    if (live) {
      activeTier = tier;
      break;
    }
  }

  const ranked = scored
    .map((q) => ({ ...q, gatedOut: q.tier !== activeTier }))
    .sort(compareRanked);

  const nextQuestion =
    ranked.find(
      (q) =>
        !q.gatedOut && !deferred.has(q.featureId) && q.eigBits >= minEigBits
    ) ?? null;

  let tierRationale: string;
  if (activeTier === null) {
    tierRationale =
      `No tier holds a question yielding at least ${minEigBits} bits. ` +
      `Evidence acquisition is complete or the remaining questions are ` +
      `uninformative given current belief.`;
  } else {
    const earlier = TIER_ORDER.slice(0, TIER_ORDER.indexOf(activeTier));
    tierRationale =
      earlier.length === 0
        ? `${activeTier} is the first tier and holds informative questions.`
        : `${earlier.join(", ")} exhausted: no unanswered, undeferred ` +
          `question there yields ${minEigBits} bits or more. Gate advanced ` +
          `to ${activeTier}.`;
  }

  return { ranked, nextQuestion, activeTier, tierRationale, minEigBits };
}