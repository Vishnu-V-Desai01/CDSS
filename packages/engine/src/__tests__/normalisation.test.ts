import { describe, expect, it } from "vitest";
import { normalise, checkNormalisation } from "../normalisation.js";

describe("normalise", () => {
  it("converts equal log-odds into equal probabilities", () => {
    const result = normalise([
      { id: "A", logOdds: 0 },
      { id: "B", logOdds: 0 },
      { id: "C", logOdds: 0 },
    ]);
    expect(result.hypotheses).toHaveLength(3);
    expect(result.hypotheses[0]!.probability).toBeCloseTo(1 / 3);
    expect(result.hypotheses[1]!.probability).toBeCloseTo(1 / 3);
    expect(result.hypotheses[2]!.probability).toBeCloseTo(1 / 3);
    expect(checkNormalisation(result)).toBe(true);
  });

  it("sums to exactly 1.0 within floating-point tolerance", () => {
    const result = normalise([
      { id: "PE", logOdds: 1.5 },
      { id: "UA", logOdds: -0.5 },
      { id: "CHF", logOdds: 2.0 },
      { id: "PERI", logOdds: -1.0 },
      { id: "UNKNOWN", logOdds: 0 },
    ]);
    expect(result.probabilitySum).toBeCloseTo(1.0, 6);
    expect(checkNormalisation(result)).toBe(true);
  });

  it("respects the ordering of log-odds", () => {
    const result = normalise([
      { id: "HIGH", logOdds: 5.0 },
      { id: "LOW", logOdds: -5.0 },
    ]);
    const high = result.hypotheses.find((h) => h.id === "HIGH")!;
    const low = result.hypotheses.find((h) => h.id === "LOW")!;
    expect(high.probability).toBeGreaterThan(low.probability);
  });

  it("handles large differences in log-odds without overflow", () => {
    // If this were implemented naively (exp(logOdds)), this would overflow.
    // The log-sum-exp form handles it correctly.
    const result = normalise([
      { id: "HUGE", logOdds: 100 },
      { id: "NORMAL", logOdds: 0 },
      { id: "TINY", logOdds: -100 },
    ]);
    expect(checkNormalisation(result)).toBe(true);
    // HUGE should dominate
    const huge = result.hypotheses.find((h) => h.id === "HUGE")!;
    expect(huge.probability).toBeGreaterThan(0.99);
  });

  it("handles negative log-odds correctly", () => {
    const result = normalise([
      { id: "A", logOdds: -2.0 },
      { id: "B", logOdds: -3.0 },
    ]);
    const a = result.hypotheses.find((h) => h.id === "A")!;
    const b = result.hypotheses.find((h) => h.id === "B")!;
    // A has higher (less negative) log-odds, so higher probability
    expect(a.probability).toBeGreaterThan(b.probability);
    expect(checkNormalisation(result)).toBe(true);
  });

  it("rejects empty hypothesis list", () => {
    expect(() => normalise([])).toThrow();
  });

  it("works with a single hypothesis (probability = 1.0)", () => {
    const result = normalise([{ id: "ONLY", logOdds: 0 }]);
    expect(result.hypotheses[0]!.probability).toBe(1.0);
    expect(checkNormalisation(result)).toBe(true);
  });

  it("is numerically stable across 9 hypotheses (real use case)", () => {
    const nineHypotheses = [
      { id: "PE", logOdds: 1.5 },
      { id: "UA", logOdds: 0.8 },
      { id: "CHF", logOdds: -1.0 },
      { id: "PERI", logOdds: -2.5 },
      { id: "ANXIETY", logOdds: 0.2 },
      { id: "MSK", logOdds: 1.2 },
      { id: "GORD", logOdds: -0.5 },
      { id: "DANGEROUS", logOdds: -3.0 },
      { id: "OTHER", logOdds: 0.0 },
    ];
    const result = normalise(nineHypotheses);
    expect(result.hypotheses).toHaveLength(9);
    expect(checkNormalisation(result, 1e-6)).toBe(true);
    // All probabilities are between 0 and 1
    for (const h of result.hypotheses) {
      expect(h.probability).toBeGreaterThan(0);
      expect(h.probability).toBeLessThan(1);
    }
  });
});