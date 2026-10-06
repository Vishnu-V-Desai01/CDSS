/**
 * Stateful inference session: the loop that wraps the pure engine.
 *
 * WHY THE TRACE IS DERIVED, NOT MAINTAINED
 * ----------------------------------------
 * evaluate() is a pure function of the evidence set. This session records a
 * finding by calling evaluate() on the cumulative evidence and differencing
 * the per-hypothesis log-odds against the previous call. The trace is thus
 * COMPUTED FROM the engine rather than kept alongside it, so the two cannot
 * disagree: checkTraceCompleteness passes by construction, not by discipline.
 *
 * ATTRIBUTION IS PATH-DEPENDENT; THE POSTERIOR IS NOT
 * ---------------------------------------------------
 * Dependency-group discounts are non-linear in the evidence set. When a second
 * correlated finding arrives, the redundancy shrinkage lands on whichever
 * finding was added second. So individual trace deltas depend on the order the
 * clinician entered things, while the final log-odds do not, because they are
 * a function of the SET. Order independence is a property of the posterior;
 * the trace is a narration of one path to it. Both claims hold simultaneously.
 *
 * CITATION RESOLUTION IS PER-HYPOTHESIS
 * --------------------------------------
 * The same feature can carry different citations for different conditions
 * (PLEURITIC_PAIN's LR for PE may cite a different source than its LR for
 * CHF). resolveCitation therefore takes the hypothesisId as a third argument
 * and is called once per hypothesis inside the update loop, not once per
 * finding — reusing a single citation across every hypothesis would silently
 * misattribute shared findings.
 *
 * HALTING
 * -------
 * A halted session answers no questions and produces no differential. The
 * trace up to the halt is retained, because the reason for stopping is part of
 * the clinical record. Red-flag detection itself belongs to the backend safety
 * gate; this is the engine-side enforcement of its verdict.
 */

import { evaluate, type EvaluateInput, type EvaluateResult } from "./evaluate.js";
import {
  TraceRecorder,
  checkTraceCompleteness,
  type TraceEntry,
  type TraceCompletenessReport,
} from "./trace.js";
import {
  rankQuestions,
  type CandidateQuestion,
  type EvidenceTier,
  type RankedQuestion,
} from "./rankQuestions.js";
import {
  DeferralQueue,
  evidentialCompleteness,
  type RescoredQuestion,
} from "./deferralQueue.js";
import { entropyBits } from "./informationGain.js";

export class SessionHaltedError extends Error {
  constructor(action: string, reason: string) {
    super(
      `Cannot ${action}: session halted (${reason}). A halted session produces ` +
        `no differential.`
    );
    this.name = "SessionHaltedError";
  }
}

export class MissingCitationError extends Error {
  constructor(featureId: string, state: string, hypothesisId: string) {
    super(
      `No citation resolves for feature "${featureId}" in state "${state}" ` +
        `for hypothesis "${hypothesisId}". Every belief change must be ` +
        `attributable to a source. Pass strictCitations: false to record it ` +
        `as UNSOURCED instead.`
    );
    this.name = "MissingCitationError";
  }
}

/** Per-feature metadata from features.registry.yaml. */
export interface FeatureMeta {
  tier: EvidenceTier;
  /** acquisition_cost from the registry. Must be > 0. */
  cost: number;
}

export interface SessionConfig {
  conditions: EvaluateInput["conditions"];
  careSetting: string;
  /** Which hypotheses are reportable conditions; the rest aggregate to UNKNOWN. */
  inScopeConditionIds: readonly string[];
  featureMeta: Readonly<Record<string, FeatureMeta>>;
  /**
   * Resolve (featureId, state, hypothesisId) to a citation id. Return null
   * when unknown. Called once per hypothesis per finding, because the same
   * feature can carry different citations under different conditions.
   */
  resolveCitation: (
    featureId: string,
    state: string,
    hypothesisId: string
  ) => string | null;
  /** Throw on unresolved citations rather than recording UNSOURCED. Default true. */
  strictCitations?: boolean;
  /** Tier-exhaustion threshold in bits. Default 0.01. */
  minEigBits?: number;
  /**
   * Are condition.features[].lrs raw ratios or already log-space?
   * MUST match what applyEvidenceSet expects. Getting this wrong yields
   * plausible but incorrect rankings.
   */
  lrScale?: "RAW" | "LOG";
}

/**
 * SessionConfig with defaults applied. Hoisted to a named alias rather than
 * written inline on the field: an inline intersection in a class member
 * position parses ambiguously against type parameter lists.
 */
type ResolvedSessionConfig = SessionConfig &
  Required<Pick<SessionConfig, "strictCitations" | "minEigBits" | "lrScale">>;

export interface ReportedDistribution {
  /** Four in-scope conditions plus the UNKNOWN aggregate. Sums to 1. */
  entries: Array<{ id: string; probability: number }>;
  /**
   * Posterior mass on in-scope conditions, i.e. 1 - P(UNKNOWN).
   * This is the design doc's "fit score". It is an IDENTITY given
   * normalisation over all hypotheses, not a separate computation, and it is
   * reported for context only — it never gates anything.
   */
  scopeFit: number;
}

export interface SessionState {
  halted: boolean;
  haltReason: string | null;
  turn: number;
  evidence: Readonly<Record<string, string>>;
  distribution: ReportedDistribution;
  /** Raw per-hypothesis output, shadows included, for debugging and reports. */
  hypotheses: EvaluateResult["hypotheses"];
  nextQuestion: RankedQuestion | null;
  tierRationale: string;
  pending: readonly RescoredQuestion[];
  /**
   * Fraction of available information already gathered. Reported ALONGSIDE the
   * posterior, never applied to it: unasked questions carry no likelihood, and
   * shrinking probabilities for them would break order independence.
   */
  evidentialCompleteness: number;
  citationsComplete: boolean;
}

export interface TurnResult extends SessionState {
  /** Trace entries produced by this turn only. */
  newTraceEntries: readonly TraceEntry[];
}

/** Build ranker candidates from the pack, merging LRs across hypotheses. */
export function buildCandidates(
  conditions: EvaluateInput["conditions"],
  featureMeta: Readonly<Record<string, FeatureMeta>>,
  lrScale: "RAW" | "LOG" = "LOG"
): CandidateQuestion[] {
  const byFeature = new Map<string, CandidateQuestion>();

  for (const condition of conditions) {
    for (const feature of condition.features) {
      const meta = featureMeta[feature.id];
      if (!meta) continue; // not askable: absent from the registry

      let candidate = byFeature.get(feature.id);
      if (!candidate) {
        candidate = {
          featureId: feature.id,
          tier: meta.tier,
          cost: meta.cost,
          hypothesisLogLrs: [],
        };
        byFeature.set(feature.id, candidate);
      }

      const logLrs: Record<string, number> = {};
      for (const [state, value] of Object.entries(feature.lrs)) {
        logLrs[state] = lrScale === "RAW" ? Math.log(value) : value;
      }

      candidate.hypothesisLogLrs.push({
        hypothesisId: condition.id,
        logLrs,
      });
    }
  }

  return [...byFeature.values()].sort((a, b) =>
    a.featureId.localeCompare(b.featureId)
  );
}

export class InferenceSession {
  private readonly config: ResolvedSessionConfig;
  private readonly recorder = new TraceRecorder();
  private readonly queue = new DeferralQueue();
  private readonly candidates: CandidateQuestion[];
  private readonly evidence: Record<string, string> = {};
  private previousLogOdds = new Map<string, number>();
  private priorEntropyBits = 0;
  private turnCount = 0;
  private haltedReason: string | null = null;
  private citationsComplete = true;

  constructor(config: SessionConfig) {
    this.config = {
      strictCitations: true,
      minEigBits: 0.01,
      lrScale: "LOG",
      ...config,
    };

    this.candidates = buildCandidates(
      config.conditions,
      config.featureMeta,
      this.config.lrScale
    );

    this.seedPriors();
  }

  /** Record each hypothesis's starting log-odds as PRIOR trace entries. */
  private seedPriors(): void {
    const result = this.runEngine();

    for (const h of [...result.hypotheses].sort((a, b) =>
      a.id.localeCompare(b.id)
    )) {
      this.recorder.record({
        type: "PRIOR",
        hypothesisId: h.id,
        featureId: null,
        state: null,
        logOddsBefore: 0,
        logOddsAfter: h.logOdds,
        rawLogLr: null,
        appliedLogLr: null,
        discountFactor: null,
        citationId: null,
        note: `Prior for care setting ${this.config.careSetting}`,
      });
      this.previousLogOdds.set(h.id, h.logOdds);
    }

    this.priorEntropyBits = entropyBits(
      result.hypotheses.map((h) => h.probability)
    );
  }

  private runEngine(): EvaluateResult {
    return evaluate({
      conditions: this.config.conditions,
      careSetting: this.config.careSetting,
      evidence: { ...this.evidence },
    });
  }

  private assertLive(action: string): void {
    if (this.haltedReason !== null) {
      throw new SessionHaltedError(action, this.haltedReason);
    }
  }

  /**
   * Record a finding. Log-odds movement is derived by differencing the engine
   * before and after, so the trace reflects what the engine actually did
   * rather than what this layer believes it should have done. Citation
   * resolution happens PER HYPOTHESIS inside the loop below.
   */
  answer(featureId: string, state: string): TurnResult {
    this.assertLive(`answer "${featureId}"`);

    const startSeq = this.recorder.length;
    this.evidence[featureId] = state;
    this.queue.resolve(featureId); // a deferred question just got answered
    this.turnCount += 1;

    const result = this.runEngine();

    for (const h of [...result.hypotheses].sort((a, b) =>
      a.id.localeCompare(b.id)
    )) {
      const before = this.previousLogOdds.get(h.id) ?? 0;
      if (before === h.logOdds) continue; // this finding says nothing about h

      let citationId = this.config.resolveCitation(featureId, state, h.id);
      if (!citationId) {
        if (this.config.strictCitations) {
          throw new MissingCitationError(featureId, state, h.id);
        }
        citationId = "UNSOURCED";
        this.citationsComplete = false;
      }

      this.recorder.record({
        type: "EVIDENCE",
        hypothesisId: h.id,
        featureId,
        state,
        logOddsBefore: before,
        logOddsAfter: h.logOdds,
        rawLogLr: null,
        appliedLogLr: h.logOdds - before,
        discountFactor: null,
        citationId,
        note: null,
      });

      this.previousLogOdds.set(h.id, h.logOdds);
    }

    return this.buildTurnResult(result, startSeq);
  }

  /** Skip a question. It keeps its score and stays answerable. */
  defer(featureId: string): TurnResult {
    this.assertLive(`defer "${featureId}"`);

    const startSeq = this.recorder.length;
    const meta = this.config.featureMeta[featureId];
    const ranked = this.rank();
    const scored = ranked.ranked.find((q) => q.featureId === featureId);

    this.queue.defer({
      featureId,
      tier: meta?.tier ?? "HISTORY",
      cost: meta?.cost ?? 1,
      impactAtDeferral: scored?.eigBits ?? 0,
      deferredAtTurn: this.turnCount,
    });

    this.recorder.record({
      type: "DEFERRAL",
      hypothesisId: null,
      featureId,
      state: null,
      logOddsBefore: 0,
      logOddsAfter: 0,
      rawLogLr: null,
      appliedLogLr: null,
      discountFactor: null,
      citationId: null,
      note: `Deferred at turn ${this.turnCount}; impact ${(
        scored?.eigBits ?? 0
      ).toFixed(4)} bits`,
    });

    return this.buildTurnResult(this.runEngine(), startSeq);
  }

  /** Stop inference. No differential is produced from here on. */
  halt(reason: string): void {
    this.haltedReason = reason;
    this.recorder.record({
      type: "DEFERRAL",
      hypothesisId: null,
      featureId: null,
      state: null,
      logOddsBefore: 0,
      logOddsAfter: 0,
      rawLogLr: null,
      appliedLogLr: null,
      discountFactor: null,
      citationId: null,
      note: `HALTED: ${reason}`,
    });
  }

  private currentLogOdds(): Array<{ id: string; logOdds: number }> {
    return [...this.previousLogOdds.entries()]
      .map(([id, logOdds]) => ({ id, logOdds }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private rank() {
    return rankQuestions({
      currentLogOdds: this.currentLogOdds(),
      candidates: this.candidates,
      answered: new Set(Object.keys(this.evidence)),
      deferred: this.queue.deferredIds(),
      minEigBits: this.config.minEigBits,
    });
  }

  private distributionOf(result: EvaluateResult): ReportedDistribution {
    const inScope = new Set(this.config.inScopeConditionIds);
    const entries = this.config.inScopeConditionIds.map((id) => ({
      id,
      probability:
        result.hypotheses.find((h) => h.id === id)?.probability ?? 0,
    }));

    const unknown = result.hypotheses
      .filter((h) => !inScope.has(h.id))
      .reduce((acc, h) => acc + h.probability, 0);

    entries.push({ id: "UNKNOWN", probability: unknown });

    return { entries, scopeFit: 1 - unknown };
  }

  private buildTurnResult(
    result: EvaluateResult,
    startSeq: number
  ): TurnResult {
    const ranked = this.rank();
    const pending = this.queue.rescore(this.currentLogOdds(), this.candidates);

    const currentEntropy = entropyBits(
      result.hypotheses.map((h) => h.probability)
    );
    const harvestedBits = Math.max(0, this.priorEntropyBits - currentEntropy);
    const pendingBits = this.queue.pendingBits(
      this.currentLogOdds(),
      this.candidates
    );

    return {
      halted: this.haltedReason !== null,
      haltReason: this.haltedReason,
      turn: this.turnCount,
      evidence: Object.freeze({ ...this.evidence }),
      distribution: this.distributionOf(result),
      hypotheses: result.hypotheses,
      nextQuestion: ranked.nextQuestion,
      tierRationale: ranked.tierRationale,
      pending,
      evidentialCompleteness: evidentialCompleteness(
        harvestedBits,
        pendingBits
      ),
      citationsComplete: this.citationsComplete,
      newTraceEntries: this.recorder.snapshot().slice(startSeq),
    };
  }

  /** Current state without recording anything. Throws if halted. */
  state(): SessionState {
    this.assertLive("read state");
    return this.buildTurnResult(this.runEngine(), this.recorder.length);
  }

  trace(): readonly TraceEntry[] {
    return this.recorder.snapshot();
  }

  /** Verify the trace reconstructs the engine's own log-odds. */
  verifyTrace(): TraceCompletenessReport {
    const result = this.runEngine();
    return checkTraceCompleteness(
      this.recorder.snapshot(),
      new Map(result.hypotheses.map((h) => [h.id, h.logOdds]))
    );
  }
}