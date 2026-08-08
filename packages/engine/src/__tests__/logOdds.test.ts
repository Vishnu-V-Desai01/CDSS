import { describe, expect, it } from "vitest";
import {
  applyEvidenceSet,
  clampForReport,
  CUMULATIVE_CLAMP,
  logOddsToProb,
  probToLogOdds,
  REPORT_PROBABILITY_CEILING,
  REPORT_PROBABILITY_FLOOR,
  SINGLE_LR_CLAMP,
} from "../logOdds.js";

describe("probToLogOdds / logOddsToProb — round trip", () => {
  it.each([0.001, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999])("round-trips p=%s", (p) => {
    const logOdds = probToLogOdds(p);
    const back = logOddsToProb(logOdds);
    expect(back).toBeCloseTo(p, 9);
  });

  it("rejects p=0 and p=1 (undefined / infinite log-odds)", () => {
    expect(() => probToLogOdds(0)).toThrow(RangeError);
    expect(() => probToLogOdds(1)).toThrow(RangeError);
  });

  it("logOddsToProb never returns exactly 0 or 1 for magnitudes this system could ever produce", () => {
    // The largest log-odds this engine can ever reach is roughly the most
    // extreme prior plus the ±ln(1000) cumulative clamp — a handful of
    // units, nowhere near the ~36 boundary where "1 + tiny" starts rounding
    // back down to exactly 1 in double precision. ±15 is already a wildly
    // unrealistic prior for anything in this domain.
    expect(logOddsToProb(-15)).toBeGreaterThan(0);
    expect(logOddsToProb(15)).toBeLessThan(1);
  });

  it("is asymmetric at the extremes — and that asymmetry is correct, not a bug", () => {
    // Doubles have vastly more room near 0 than near 1: the smallest gap
    // between representable numbers near 1.0 is ~2.22e-16 (machine
    // epsilon), so nothing between 1-2.22e-16 and 1 can be represented at
    // all — logOddsToProb(100) collapsing to exactly 1 is unavoidable.
    expect(logOddsToProb(100)).toBe(1);
    expect(logOddsToProb(1000)).toBe(1);

    // Near 0, doubles keep full relative precision down to ~1e-308, and the
    // negative branch (e / (1+e)) preserves that: it doesn't lose accuracy
    // just because "1 + e" itself rounds to 1 in the denominator, because e
    // was already computed as its own full-precision double beforehand.
    // So -100 does NOT collapse to exactly 0 — only once exp(x) itself
    // underflows, around x ≈ -745, does it become exactly 0.
    expect(logOddsToProb(-100)).toBeGreaterThan(0);
    expect(logOddsToProb(-100)).toBeCloseTo(3.72e-44, 46);
    expect(logOddsToProb(-1000)).toBe(0);
  });
});

describe("clampForReport — §2.5 floor/ceiling", () => {
  it("floors 0 to 0.0001 and ceilings 1 to 0.9999", () => {
    expect(clampForReport(0)).toBe(REPORT_PROBABILITY_FLOOR);
    expect(clampForReport(1)).toBe(REPORT_PROBABILITY_CEILING);
  });

  it("leaves mid-range values untouched", () => {
    expect(clampForReport(0.42)).toBe(0.42);
  });
});

describe("applyEvidenceSet — single-LR clamp (±ln20)", () => {
  it("passes a normal log-LR through unchanged", () => {
    const result = applyEvidenceSet(0, [{ label: "a", rawLogLr: 0.5 }]);
    expect(result.contributions[0]!.logLrApplied).toBeCloseTo(0.5);
    expect(result.contributions[0]!.singleClampApplied).toBe(false);
    expect(result.cumulativeClampApplied).toBe(false);
    expect(result.logOddsAfter).toBeCloseTo(0.5);
  });

  it("clamps a single log-LR that exceeds ln(20)", () => {
    const huge = Math.log(500); // way past ln(20) ~ 3.0
    const result = applyEvidenceSet(0, [{ label: "a", rawLogLr: huge }]);
    expect(result.contributions[0]!.singleClampApplied).toBe(true);
    expect(result.contributions[0]!.logLrApplied).toBeCloseTo(SINGLE_LR_CLAMP);
  });

  it("clamps a single log-LR that is very negative, symmetrically", () => {
    const hugeNeg = -Math.log(500);
    const result = applyEvidenceSet(0, [{ label: "a", rawLogLr: hugeNeg }]);
    expect(result.contributions[0]!.logLrApplied).toBeCloseTo(-SINGLE_LR_CLAMP);
  });
});

describe("applyEvidenceSet — cumulative displacement clamp (±ln1000)", () => {
  it("clamps the total when many individually-legal log-LRs sum past ln(1000)", () => {
    // Each item is well within the single-item clamp (ln20 ~ 3.0), but 500 of
    // them summing to 1.0 each would be 500 >> ln(1000) ~ 6.9.
    const items = Array.from({ length: 500 }, (_, i) => ({ label: `f${i}`, rawLogLr: 1.0 }));
    const result = applyEvidenceSet(0, items);
    expect(result.cumulativeClampApplied).toBe(true);
    expect(result.appliedDisplacement).toBeCloseTo(CUMULATIVE_CLAMP);
    expect(result.logOddsAfter).toBeCloseTo(CUMULATIVE_CLAMP);
    // None of the individual items should have been single-clamped — this is
    // purely the cumulative clamp doing its job.
    expect(result.contributions.every((c) => !c.singleClampApplied)).toBe(true);
  });

  it("does not clamp when the total is within ±ln(1000)", () => {
    const items = [
      { label: "a", rawLogLr: 1.0 },
      { label: "b", rawLogLr: -0.5 },
      { label: "c", rawLogLr: 2.0 },
    ];
    const result = applyEvidenceSet(0, items);
    expect(result.cumulativeClampApplied).toBe(false);
    expect(result.logOddsAfter).toBeCloseTo(2.5);
  });
});

describe("applyEvidenceSet — order independence under clamping (spec §2.6 C1)", () => {
  it("produces identical output for permuted evidence, even when the cumulative clamp fires", () => {
    // Deliberately mix strong positive and negative evidence so an
    // *incremental* per-step clamp would have given a different answer
    // depending on order (this is the bug the batch design fixes).
    const items = [
      { label: "a", rawLogLr: 5.0 },
      { label: "b", rawLogLr: 5.0 },
      { label: "c", rawLogLr: -8.0 },
      { label: "d", rawLogLr: 4.0 },
      { label: "e", rawLogLr: -2.0 },
    ];

    const forward = applyEvidenceSet(0, items);
    const reversed = applyEvidenceSet(0, [...items].reverse());
    const shuffled = applyEvidenceSet(
      0,
      [items[2]!, items[0]!, items[4]!, items[1]!, items[3]!],
    );

    expect(forward.logOddsAfter).toBeCloseTo(reversed.logOddsAfter, 12);
    expect(forward.logOddsAfter).toBeCloseTo(shuffled.logOddsAfter, 12);
    expect(forward.cumulativeClampApplied).toBe(reversed.cumulativeClampApplied);
  });

  it("gives the same result regardless of prior magnitude, modulo the prior itself", () => {
    const items = [
      { label: "a", rawLogLr: 3.0 },
      { label: "b", rawLogLr: -1.0 },
    ];
    const fromZero = applyEvidenceSet(0, items);
    const fromNonzero = applyEvidenceSet(1.5, items);
    expect(fromNonzero.logOddsAfter - fromZero.logOddsAfter).toBeCloseTo(1.5, 9);
  });
});