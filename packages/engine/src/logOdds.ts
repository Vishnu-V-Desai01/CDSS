/**
 * Log-odds arithmetic, per CDS-CV-FOUNDATION-SPEC-v1.0 §1.2.
 *
 * Why log-odds and not probability directly: likelihood ratios combine by
 * multiplication in probability-odds space, which means by *addition* in
 * log-odds space. That turns "apply N pieces of evidence" into a running
 * sum instead of a chain of multiplications — which is what makes order
 * independence (spec §2.6 C1) straightforward to prove: addition commutes,
 * so summing the same set of log-LRs in any order gives the same total,
 * up to floating point rounding. If we worked in raw probability space
 * instead, we'd be renormalising after every step, which does NOT commute
 * cleanly across a 9-hypothesis simplex.
 */

/** §1.2: any single applied log-LR is clamped to ±ln(20). */
export const SINGLE_LR_CLAMP = Math.log(20);

/** §1.2: cumulative log-odds displacement from prior, per condition, clamped to ±ln(1000). */
export const CUMULATIVE_CLAMP = Math.log(1000);

/** §2.5: no reported probability may be exactly 0 or 1 — certainty is not expressible. */
export const REPORT_PROBABILITY_FLOOR = 0.0001;
export const REPORT_PROBABILITY_CEILING = 0.9999;

function clampTo(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** p in (0,1) -> ln(p / (1-p)). Callers must not pass exactly 0 or 1 (undefined / infinite). */
export function probToLogOdds(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError(`probToLogOdds: p must be strictly between 0 and 1, got ${p}`);
  }
  return Math.log(p / (1 - p));
}

/**
 * ln(p/(1-p)) -> p, via the logistic function.
 *
 * Implemented as the numerically-stable two-branch form rather than the
 * textbook 1/(1+exp(-x)) directly: for very negative x, exp(-x) overflows
 * to Infinity in a 64-bit double before the division ever happens, which
 * would silently return exactly 0. Branching on sign keeps exp()'s argument
 * on the side that can't overflow.
 *
 * The two branches are NOT symmetric in how they fail at extremes, and
 * that's inherent to floating point, not a flaw here:
 *   - For large positive logOdds, 1/(1+exp(-x)) collapses to exactly 1 once
 *     exp(-x) drops below machine epsilon (~x > 36) — because doubles can't
 *     represent anything between 1-2.22e-16 and 1 in the first place. No
 *     algebraic rewrite fixes this; it's a hard limit near 1.0.
 *   - For large negative logOdds, exp(x)/(1+exp(x)) stays accurate far
 *     longer, because doubles have full relative precision all the way down
 *     to ~1e-308 near zero, and the numerator here is a self-contained
 *     value that isn't destroyed by the denominator's rounding. It only
 *     becomes exactly 0 once exp(x) itself underflows, around x ≈ -745.
 *
 * None of this matters in practice: priors are never that extreme and the
 * cumulative displacement clamp (§1.2) bounds movement to ±ln(1000) ≈ 6.9,
 * so this engine's log-odds values stay in single digits.
 */
export function logOddsToProb(logOdds: number): number {
  if (logOdds >= 0) {
    return 1 / (1 + Math.exp(-logOdds));
  }
  const e = Math.exp(logOdds);
  return e / (1 + e);
}

/**
 * Clamp a probability into the reportable range per §2.5. This is a
 * *serialization*-layer clamp — it exists so the JSON response never claims
 * certainty. It is separate from, and applied after, the internal log-odds
 * clamps below, which bound how far evidence is allowed to move belief.
 */
export function clampForReport(p: number): number {
  return Math.min(REPORT_PROBABILITY_CEILING, Math.max(REPORT_PROBABILITY_FLOOR, p));
}

export interface LogLrItem {
  /** Identifies the contribution for trace/debugging purposes only — not used in the math. */
  label: string;
  rawLogLr: number;
}

export interface ClampedContribution extends LogLrItem {
  logLrApplied: number;
  singleClampApplied: boolean;
}

export interface ApplyEvidenceSetResult {
  logOddsAfter: number;
  /** Each input item after individual (±ln20) clamping — for trace entries. */
  contributions: ClampedContribution[];
  /** True if the ±ln(1000) cumulative-displacement clamp fired on the total. */
  cumulativeClampApplied: boolean;
  /** The displacement from prior actually applied, after the cumulative clamp. */
  appliedDisplacement: number;
}

/**
 * Apply an entire evidence set's worth of log-LRs for one condition in a
 * single pure computation. This is the ONLY correct way to apply the §1.2
 * clamps and remain order-independent (spec §2.6 C1):
 *
 *   1. Each individual log-LR is clamped to ±ln(20) — this step is trivially
 *      order-independent since it only looks at one value at a time.
 *   2. The clamped values are summed. Addition commutes: any permutation of
 *      the same evidence set produces the same sum.
 *   3. The cumulative displacement (sum) from the prior is clamped ONCE, to
 *      ±ln(1000) — not per intermediate step. A single clamp on a fixed
 *      total is itself order-independent, because there is no "intermediate
 *      state" for the clamp to depend on the order of.
 *
 * Do NOT re-introduce a step-by-step incremental version of this as an
 * optimisation — see the comment in the original draft above, and spec §2.1.
 */
export function applyEvidenceSet(priorLogOdds: number, items: LogLrItem[]): ApplyEvidenceSetResult {
  const contributions: ClampedContribution[] = items.map((item) => {
    const logLrApplied = clampTo(item.rawLogLr, SINGLE_LR_CLAMP);
    return { ...item, logLrApplied, singleClampApplied: logLrApplied !== item.rawLogLr };
  });

  const totalDisplacement = contributions.reduce((sum, c) => sum + c.logLrApplied, 0);
  const appliedDisplacement = clampTo(totalDisplacement, CUMULATIVE_CLAMP);
  const cumulativeClampApplied = appliedDisplacement !== totalDisplacement;

  return {
    logOddsAfter: priorLogOdds + appliedDisplacement,
    contributions,
    cumulativeClampApplied,
    appliedDisplacement,
  };
}