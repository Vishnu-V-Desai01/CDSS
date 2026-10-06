/**
 * Deferral queue: questions the clinician skipped, still answerable later.
 *
 * WHY THIS IS ALMOST TRIVIAL
 * --------------------------
 * The hard requirement — "when answered, update exactly as if it had arrived
 * in sequence" — is already satisfied by the log-odds representation. Belief
 * update is addition, addition is commutative, so arrival order cannot matter.
 * This queue therefore does no arithmetic on beliefs at all: it is bookkeeping
 * over which questions are outstanding and what they are worth. If it ever
 * needed to "replay" a deferred answer, that would be evidence the engine had
 * stopped being order-independent.
 *
 * TWO IMPACT SCORES, DELIBERATELY
 * -------------------------------
 * impactAtDeferral is the expected information gain at the moment of skipping:
 * immutable history, the record of what was declined and what it was worth.
 * currentImpact is recomputed against present belief: what asking it now would
 * actually buy. These diverge as the session proceeds, and reporting only the
 * first would systematically overstate the value of stale questions.
 */

import { expectedInformationGain } from "./informationGain.js";
import type { CandidateQuestion, EvidenceTier } from "./rankQuestions.js";

export interface DeferredQuestion {
  readonly featureId: string;
  readonly tier: EvidenceTier;
  readonly cost: number;
  /** EIG in bits when the clinician skipped it. Never recomputed. */
  readonly impactAtDeferral: number;
  /** Turn index at which it was deferred, for the trace. */
  readonly deferredAtTurn: number;
}

export interface RescoredQuestion extends DeferredQuestion {
  /**
   * EIG in bits against CURRENT belief, or null when the feature is no longer
   * among the candidates (e.g. removed from the pack between sessions).
   */
  readonly currentImpact: number | null;
  /** currentImpact / cost, or null alongside a null impact. */
  readonly currentValue: number | null;
}

/**
 * Append-and-resolve store. Deliberately not a general-purpose collection:
 * the only mutations are defer and resolve.
 */
export class DeferralQueue {
  private readonly queue = new Map<string, DeferredQuestion>();

  /**
   * Record a skip. Re-deferring an already-deferred question is a no-op that
   * PRESERVES the original impactAtDeferral, because that field is a
   * historical record and must not be overwritten by a later observation.
   */
  defer(question: DeferredQuestion): DeferredQuestion {
    const existing = this.queue.get(question.featureId);
    if (existing) return existing;

    const frozen = Object.freeze({ ...question });
    this.queue.set(question.featureId, frozen);
    return frozen;
  }

  /** Remove a question, typically because it was finally answered. */
  resolve(featureId: string): boolean {
    return this.queue.delete(featureId);
  }

  isDeferred(featureId: string): boolean {
    return this.queue.has(featureId);
  }

  /** Feature ids only — the shape rankQuestions expects for its gate. */
  deferredIds(): ReadonlySet<string> {
    return new Set(this.queue.keys());
  }

  /** Frozen snapshot, sorted by feature id for determinism. */
  pending(): readonly DeferredQuestion[] {
    return Object.freeze(
      [...this.queue.values()].sort((a, b) =>
        a.featureId.localeCompare(b.featureId)
      )
    );
  }

  get size(): number {
    return this.queue.size;
  }

  /**
   * Recompute every pending question's worth against current belief.
   * Sorted by current impact descending, ties broken by feature id.
   */
  rescore(
    currentLogOdds: Array<{ id: string; logOdds: number }>,
    candidates: readonly CandidateQuestion[]
  ): readonly RescoredQuestion[] {
    const byId = new Map(candidates.map((c) => [c.featureId, c]));

    const rescored = this.pending().map((q): RescoredQuestion => {
      const candidate = byId.get(q.featureId);
      if (!candidate) {
        return { ...q, currentImpact: null, currentValue: null };
      }

      const eig = expectedInformationGain({
        featureId: q.featureId,
        currentLogOdds,
        hypothesisLogLrs: candidate.hypothesisLogLrs,
      });

      return {
        ...q,
        currentImpact: eig.eigBits,
        currentValue: eig.eigBits / q.cost,
      };
    });

    return Object.freeze(
      [...rescored].sort((a, b) => {
        const av = a.currentImpact ?? -1;
        const bv = b.currentImpact ?? -1;
        if (bv !== av) return bv - av;
        return a.featureId.localeCompare(b.featureId);
      })
    );
  }

  /** Total information still recoverable from the queue, in bits. */
  pendingBits(
    currentLogOdds: Array<{ id: string; logOdds: number }>,
    candidates: readonly CandidateQuestion[]
  ): number {
    return this.rescore(currentLogOdds, candidates)
      .map((q) => q.currentImpact ?? 0)
      .reduce((a, b) => a + b, 0);
  }
}

/**
 * Evidential completeness: the fraction of available information already
 * gathered.
 *
 * This is the honest form of the spec's "confidence is reduced if high-impact
 * questions remain unanswered". It is reported ALONGSIDE the posterior and
 * never applied to it. Shrinking probabilities because a question went unasked
 * would break order-independence and is not a Bayesian operation: an unasked
 * question carries no likelihood.
 *
 * Returns 1 when there is nothing left to learn, which is the correct reading
 * of an empty queue rather than a degenerate case.
 */
export function evidentialCompleteness(
  harvestedBits: number,
  pendingBits: number
): number {
  const harvested = Math.max(0, harvestedBits);
  const pending = Math.max(0, pendingBits);
  const total = harvested + pending;
  if (total <= 0) return 1;
  return harvested / total;
}