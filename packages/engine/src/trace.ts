/**
 * Append-only inference trace.
 *
 * Design contract: the trace is COMPLETE and RECONSTRUCTIVE.
 *   - Complete:      every change to any hypothesis's log-odds emits exactly one entry.
 *   - Reconstructive: for every hypothesis h,
 *                     finalLogOdds(h) === sum of deltas of h's entries.
 *
 * The second property is machine-checkable (see reconstructLogOdds) and is what
 * lets the clinical report be generated FROM the trace rather than recomputed
 * alongside it. If the two ever disagree, the trace is wrong, not the report.
 */

export type TraceEventType =
  | "PRIOR"                // seeding a hypothesis with its care-setting prior
  | "EVIDENCE"             // a finding's log-LR applied to a hypothesis
  | "DEPENDENCY_DISCOUNT"  // redundancy shrinkage on a correlated finding
  | "DEFERRAL"             // question skipped (no log-odds movement)
  | "RESUMPTION";          // deferred question later answered (bookkeeping)

export interface TraceEntry {
  /** Monotonic, gap-free, assigned by the recorder. Never reordered. */
  readonly seq: number;
  readonly type: TraceEventType;
  /** Which hypothesis moved. Null only for non-belief events (DEFERRAL). */
  readonly hypothesisId: string | null;
  readonly featureId: string | null;
  /** Observed state, e.g. "PRESENT" | "ABSENT" | "WELLS_HIGH". */
  readonly state: string | null;
  readonly logOddsBefore: number;
  readonly logOddsAfter: number;
  /** logOddsAfter - logOddsBefore. Derived; never supplied by callers. */
  readonly delta: number;
  /** log-LR as authored in the pack, before any discount. */
  readonly rawLogLr: number | null;
  /** log-LR actually added, after dependency-group discount. */
  readonly appliedLogLr: number | null;
  /** Multiplier from the dependency group, 1.0 when ungrouped. */
  readonly discountFactor: number | null;
  /** Citation id from the pack. REQUIRED for EVIDENCE entries. */
  readonly citationId: string | null;
  readonly note: string | null;
}

export type TraceInput = Omit<TraceEntry, "seq" | "delta">;

export class TraceMissingCitationError extends Error {
  constructor(featureId: string | null, hypothesisId: string | null) {
    super(
      `EVIDENCE trace entry for feature "${featureId}" on hypothesis ` +
        `"${hypothesisId}" has no citationId. Every belief change must be ` +
        `attributable to a source.`
    );
    this.name = "TraceMissingCitationError";
  }
}

/**
 * Append-only recorder. There is deliberately no update, delete, or reorder
 * method: an inference trace that can be edited after the fact is not evidence
 * of anything.
 */
export class TraceRecorder {
  private readonly entries: TraceEntry[] = [];
  private nextSeq = 0;

  record(input: TraceInput): TraceEntry {
    if (input.type === "EVIDENCE" && !input.citationId) {
      throw new TraceMissingCitationError(input.featureId, input.hypothesisId);
    }

    const entry: TraceEntry = Object.freeze({
      ...input,
      seq: this.nextSeq++,
      delta: input.logOddsAfter - input.logOddsBefore,
    });

    this.entries.push(entry);
    return entry;
  }

  /** Frozen shallow copy. Callers cannot mutate the recorder through it. */
  snapshot(): readonly TraceEntry[] {
    return Object.freeze([...this.entries]);
  }

  forHypothesis(hypothesisId: string): readonly TraceEntry[] {
    return Object.freeze(
      this.entries.filter((e) => e.hypothesisId === hypothesisId)
    );
  }

  get length(): number {
    return this.entries.length;
  }
}

/**
 * Replay a trace into final log-odds per hypothesis.
 *
 * This is the completeness check: run it against evaluate()'s own output and
 * the two must agree to floating-point tolerance. Any belief movement that
 * skipped the recorder shows up here as a mismatch.
 */
export function reconstructLogOdds(
  trace: readonly TraceEntry[]
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of trace) {
    if (entry.hypothesisId === null) continue; // non-belief event
    const running = totals.get(entry.hypothesisId) ?? 0;
    totals.set(entry.hypothesisId, running + entry.delta);
  }

  return totals;
}

export interface TraceCompletenessReport {
  complete: boolean;
  mismatches: Array<{
    hypothesisId: string;
    reconstructed: number;
    reported: number;
    difference: number;
  }>;
  uncitedEvidenceEntries: number[]; // seq numbers
}

export function checkTraceCompleteness(
  trace: readonly TraceEntry[],
  reportedLogOdds: ReadonlyMap<string, number> | Record<string, number>,
  tolerance = 1e-9
): TraceCompletenessReport {
  const reported =
    reportedLogOdds instanceof Map
      ? reportedLogOdds
      : new Map(Object.entries(reportedLogOdds));

  const reconstructed = reconstructLogOdds(trace);
  const mismatches: TraceCompletenessReport["mismatches"] = [];

  const allIds = new Set([...reconstructed.keys(), ...reported.keys()]);
  for (const id of allIds) {
    const r = reconstructed.get(id) ?? 0;
    const p = reported.get(id) ?? 0;
    const difference = Math.abs(r - p);
    if (difference > tolerance) {
      mismatches.push({
        hypothesisId: id,
        reconstructed: r,
        reported: p,
        difference,
      });
    }
  }

  const uncitedEvidenceEntries = trace
    .filter((e) => e.type === "EVIDENCE" && !e.citationId)
    .map((e) => e.seq);

  return {
    complete: mismatches.length === 0 && uncitedEvidenceEntries.length === 0,
    mismatches,
    uncitedEvidenceEntries,
  };
}