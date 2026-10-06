import { describe, expect, it } from "vitest";
import {
  TraceRecorder,
  TraceMissingCitationError,
  reconstructLogOdds,
  checkTraceCompleteness,
  type TraceInput,
} from "../trace.js";

function evidenceEntry(overrides: Partial<TraceInput> = {}): TraceInput {
  return {
    type: "EVIDENCE",
    hypothesisId: "PE",
    featureId: "PLEURITIC_PAIN",
    state: "PRESENT",
    logOddsBefore: 0,
    logOddsAfter: 0.5,
    rawLogLr: 0.5,
    appliedLogLr: 0.5,
    discountFactor: 1.0,
    citationId: "KLINE_2008",
    note: null,
    ...overrides,
  };
}

describe("TraceRecorder", () => {
  it("assigns monotonic gap-free sequence numbers", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry());
    r.record(evidenceEntry({ featureId: "TACHYCARDIA" }));
    r.record(evidenceEntry({ featureId: "HAEMOPTYSIS" }));

    expect(r.snapshot().map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("derives delta rather than trusting the caller", () => {
    const r = new TraceRecorder();
    const e = r.record(
      evidenceEntry({ logOddsBefore: -1.2, logOddsAfter: -0.4 })
    );
    expect(e.delta).toBeCloseTo(0.8, 12);
  });

  it("rejects EVIDENCE entries with no citation", () => {
    const r = new TraceRecorder();
    expect(() => r.record(evidenceEntry({ citationId: null }))).toThrow(
      TraceMissingCitationError
    );
  });

  it("allows non-EVIDENCE entries without a citation", () => {
    const r = new TraceRecorder();
    expect(() =>
      r.record(
        evidenceEntry({
          type: "PRIOR",
          featureId: null,
          state: null,
          citationId: null,
          rawLogLr: null,
          appliedLogLr: null,
          discountFactor: null,
        })
      )
    ).not.toThrow();
  });

  it("is append-only: snapshots cannot mutate the recorder", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry());
    const snap = r.snapshot();

    expect(() => (snap as unknown as unknown[]).push({})).toThrow();
    expect(() => {
      (snap[0] as { seq: number }).seq = 99;
    }).toThrow();
    expect(r.length).toBe(1);
  });

  it("filters entries by hypothesis", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry({ hypothesisId: "PE" }));
    r.record(evidenceEntry({ hypothesisId: "CHF" }));
    r.record(evidenceEntry({ hypothesisId: "PE" }));

    expect(r.forHypothesis("PE")).toHaveLength(2);
    expect(r.forHypothesis("CHF")).toHaveLength(1);
  });
});

describe("reconstructLogOdds", () => {
  it("sums deltas per hypothesis", () => {
    const r = new TraceRecorder();
    r.record(
      evidenceEntry({ hypothesisId: "PE", logOddsBefore: 0, logOddsAfter: 0.5 })
    );
    r.record(
      evidenceEntry({
        hypothesisId: "PE",
        featureId: "TACHYCARDIA",
        logOddsBefore: 0.5,
        logOddsAfter: 1.1,
      })
    );
    r.record(
      evidenceEntry({
        hypothesisId: "CHF",
        logOddsBefore: 0,
        logOddsAfter: -0.3,
      })
    );

    const totals = reconstructLogOdds(r.snapshot());
    expect(totals.get("PE")).toBeCloseTo(1.1, 12);
    expect(totals.get("CHF")).toBeCloseTo(-0.3, 12);
  });

  it("is invariant to the order deltas were recorded in", () => {
    // Same three movements, recorded in two different orders.
    const forward = new TraceRecorder();
    forward.record(evidenceEntry({ logOddsBefore: 0, logOddsAfter: 0.5 }));
    forward.record(
      evidenceEntry({
        featureId: "TACHYCARDIA",
        logOddsBefore: 0.5,
        logOddsAfter: 1.1,
      })
    );
    forward.record(
      evidenceEntry({
        featureId: "HAEMOPTYSIS",
        logOddsBefore: 1.1,
        logOddsAfter: 0.9,
      })
    );

    const shuffled = new TraceRecorder();
    shuffled.record(
      evidenceEntry({
        featureId: "HAEMOPTYSIS",
        logOddsBefore: 0,
        logOddsAfter: -0.2,
      })
    );
    shuffled.record(
      evidenceEntry({
        featureId: "TACHYCARDIA",
        logOddsBefore: -0.2,
        logOddsAfter: 0.4,
      })
    );
    shuffled.record(evidenceEntry({ logOddsBefore: 0.4, logOddsAfter: 0.9 }));

    expect(reconstructLogOdds(forward.snapshot()).get("PE")).toBeCloseTo(
      reconstructLogOdds(shuffled.snapshot()).get("PE")!,
      12
    );
  });

  it("ignores non-belief events", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry({ logOddsBefore: 0, logOddsAfter: 0.5 }));
    r.record(
      evidenceEntry({
        type: "DEFERRAL",
        hypothesisId: null,
        logOddsBefore: 0,
        logOddsAfter: 0,
        citationId: null,
        rawLogLr: null,
        appliedLogLr: null,
        discountFactor: null,
      })
    );

    expect(reconstructLogOdds(r.snapshot()).get("PE")).toBeCloseTo(0.5, 12);
  });
});

describe("checkTraceCompleteness", () => {
  it("passes when the trace reconstructs the reported log-odds", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry({ logOddsBefore: 0, logOddsAfter: 0.5 }));
    r.record(
      evidenceEntry({
        hypothesisId: "CHF",
        logOddsBefore: 0,
        logOddsAfter: -0.3,
      })
    );

    const report = checkTraceCompleteness(r.snapshot(), { PE: 0.5, CHF: -0.3 });
    expect(report.complete).toBe(true);
    expect(report.mismatches).toHaveLength(0);
  });

  it("detects a belief movement that bypassed the recorder", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry({ logOddsBefore: 0, logOddsAfter: 0.5 }));

    // Reported log-odds moved further than the trace can account for.
    const report = checkTraceCompleteness(r.snapshot(), { PE: 0.9 });
    expect(report.complete).toBe(false);
    expect(report.mismatches).toHaveLength(1);

    const mismatch = report.mismatches[0]!;
    expect(mismatch.hypothesisId).toBe("PE");
    expect(mismatch.difference).toBeCloseTo(0.4, 12);
  });

  it("detects a hypothesis present in the result but absent from the trace", () => {
    const r = new TraceRecorder();
    r.record(evidenceEntry({ logOddsBefore: 0, logOddsAfter: 0.5 }));

    const report = checkTraceCompleteness(r.snapshot(), { PE: 0.5, UA: -0.7 });
    expect(report.complete).toBe(false);
    expect(report.mismatches.map((m) => m.hypothesisId)).toContain("UA");
  });
});