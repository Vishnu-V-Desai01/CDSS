import { describe, expect, it } from "vitest";
import {
  entropyBits,
  invertBinaryLikelihoodRatios,
  stateLikelihoods,
  expectedInformationGain,
  type EigInput,
} from "../informationGain.js";

describe("entropyBits", () => {
  it("is 1 bit for a fair two-way split", () => {
    expect(entropyBits([0.5, 0.5])).toBeCloseTo(1, 12);
  });

  it("is 0 for certainty", () => {
    expect(entropyBits([1, 0, 0])).toBeCloseTo(0, 12);
  });
});

describe("invertBinaryLikelihoodRatios", () => {
  it("recovers an operating point that regenerates both LRs", () => {
    const result = invertBinaryLikelihoodRatios(2.0, 0.5)!;
    expect(result.sensitivity).toBeCloseTo(2 / 3, 10);
    expect(result.specificity).toBeCloseTo(2 / 3, 10);

    // Round-trip: the recovered s and p must reproduce the inputs.
    const { sensitivity: s, specificity: p } = result;
    expect(s / (1 - p)).toBeCloseTo(2.0, 10);
    expect((1 - s) / p).toBeCloseTo(0.5, 10);
  });

  it("handles the mirror case where the first state argues against", () => {
    const result = invertBinaryLikelihoodRatios(0.5, 2.0)!;
    expect(result.sensitivity).toBeCloseTo(1 / 3, 10);
    expect(result.specificity).toBeCloseTo(1 / 3, 10);
  });

  it("returns null for an incoherent pair with both LRs above 1", () => {
    // No sensitivity/specificity pair can produce LR+ = 2.0 and LR- = 1.5.
    expect(invertBinaryLikelihoodRatios(2.0, 1.5)).toBeNull();
  });

  it("returns null for an uninformative pair", () => {
    expect(invertBinaryLikelihoodRatios(1.0, 1.0)).toBeNull();
  });
});

describe("stateLikelihoods", () => {
  it("uses exact inversion for a coherent binary feature", () => {
    const result = stateLikelihoods({
      PRESENT: Math.log(2.0),
      ABSENT: Math.log(0.5),
    });
    expect(result.method).toBe("EXACT_BINARY");
    // Sorted keys put ABSENT first, so it is treated as state A.
    const total = result.probabilities.ABSENT! + result.probabilities.PRESENT!;
    expect(total).toBeCloseTo(1, 12);
  });

  it("falls back to the approximation for an incoherent binary pair", () => {
    const result = stateLikelihoods({
      PRESENT: Math.log(2.0),
      ABSENT: Math.log(1.5),
    });
    expect(result.method).toBe("APPROXIMATE_UNIFORM_BACKGROUND");
    expect(
      result.probabilities.ABSENT! + result.probabilities.PRESENT!
    ).toBeCloseTo(1, 12);
  });

  it("approximates multi-state features and still sums to 1", () => {
    const result = stateLikelihoods({
      WELLS_LOW: Math.log(0.13),
      WELLS_MODERATE: Math.log(1.82),
      WELLS_HIGH: Math.log(6.75),
    });
    expect(result.method).toBe("APPROXIMATE_UNIFORM_BACKGROUND");
    const total = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
  });
});

/** Two equally likely hypotheses, one binary feature, symmetric LRs. */
function symmetricCase(lrPositive: number): EigInput {
  return {
    featureId: "TEST_FEATURE",
    currentLogOdds: [
      { id: "DISEASE_A", logOdds: 0 },
      { id: "DISEASE_B", logOdds: 0 },
    ],
    hypothesisLogLrs: [
      {
        hypothesisId: "DISEASE_A",
        logLrs: {
          PRESENT: Math.log(lrPositive),
          ABSENT: Math.log(1 / lrPositive),
        },
      },
      {
        hypothesisId: "DISEASE_B",
        logLrs: {
          PRESENT: Math.log(1 / lrPositive),
          ABSENT: Math.log(lrPositive),
        },
      },
    ],
  };
}

describe("expectedInformationGain", () => {
  it("is near zero for an uninformative feature", () => {
    const result = expectedInformationGain(symmetricCase(1.0));
    expect(result.eigBits).toBeCloseTo(0, 9);
  });

  it("is large for a strongly discriminating feature", () => {
    const result = expectedInformationGain(symmetricCase(9.0));
    expect(result.currentEntropyBits).toBeCloseTo(1, 12);
    expect(result.eigBits).toBeGreaterThan(0.85);
    expect(result.eigBits).toBeLessThan(0.95);
  });

  it("ranks a strong discriminator above a weak one", () => {
    const strong = expectedInformationGain(symmetricCase(9.0));
    const weak = expectedInformationGain(symmetricCase(1.5));
    expect(strong.eigBits).toBeGreaterThan(weak.eigBits);
  });

  it("never exceeds the current entropy", () => {
    const result = expectedInformationGain(symmetricCase(50.0));
    expect(result.eigBits).toBeLessThanOrEqual(
      result.currentEntropyBits + 1e-9
    );
  });

  it("produces predictive state probabilities that sum to 1", () => {
    const result = expectedInformationGain(symmetricCase(4.0));
    const total = Object.values(result.predictedStateProbabilities).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("flags hypotheses whose LR pair could not be inverted", () => {
    const input: EigInput = {
      featureId: "SUSPECT_FEATURE",
      currentLogOdds: [
        { id: "DISEASE_A", logOdds: 0 },
        { id: "DISEASE_B", logOdds: 0 },
      ],
      hypothesisLogLrs: [
        {
          hypothesisId: "DISEASE_A",
          logLrs: { PRESENT: Math.log(2.0), ABSENT: Math.log(1.5) },
        },
        {
          hypothesisId: "DISEASE_B",
          logLrs: { PRESENT: Math.log(0.5), ABSENT: Math.log(2.0) },
        },
      ],
    };

    const result = expectedInformationGain(input);
    expect(result.incoherentHypotheses).toEqual(["DISEASE_A"]);
    expect(result.method).toBe("APPROXIMATE_UNIFORM_BACKGROUND");
  });

  it("is deterministic under reordering of hypotheses and states", () => {
    const forward = expectedInformationGain(symmetricCase(4.0));

    const reordered: EigInput = {
      featureId: "TEST_FEATURE",
      currentLogOdds: [
        { id: "DISEASE_B", logOdds: 0 },
        { id: "DISEASE_A", logOdds: 0 },
      ],
      hypothesisLogLrs: [
        {
          hypothesisId: "DISEASE_B",
          logLrs: { ABSENT: Math.log(4.0), PRESENT: Math.log(0.25) },
        },
        {
          hypothesisId: "DISEASE_A",
          logLrs: { ABSENT: Math.log(0.25), PRESENT: Math.log(4.0) },
        },
      ],
    };

    // Bit-identical, not merely close.
    expect(expectedInformationGain(reordered).eigBits).toBe(forward.eigBits);
  });
});