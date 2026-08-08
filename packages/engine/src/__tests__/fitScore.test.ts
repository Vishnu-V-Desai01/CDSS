import { describe, expect, it } from "vitest";
import { computeFitScore } from "../fitScore.js";

describe("computeFitScore", () => {
  it("returns 1.0 when all observed states match expected", () => {
    const profile = [
      { featureId: "HR", expectedStates: ["HIGH"], weight: 2, hallmark: false },
      { featureId: "PAIN", expectedStates: ["PLEURITIC"], weight: 1, hallmark: false },
    ];
    const observed = { HR: "HIGH", PAIN: "PLEURITIC" };
    const result = computeFitScore(profile, observed);
    expect(result.status).toBe("SUFFICIENT");
    expect(result.score).toBeCloseTo(1.0);
  });

  it("reduces score when observed states contradict expected", () => {
    const profile = [
      { featureId: "HR", expectedStates: ["HIGH"], weight: 2, hallmark: false },
      { featureId: "PAIN", expectedStates: ["PLEURITIC"], weight: 2, hallmark: false },
    ];
    const observed = { HR: "HIGH", PAIN: "DULL" };
    const result = computeFitScore(profile, observed);
    expect(result.status).toBe("SUFFICIENT");
    expect(result.score).toBeLessThan(1.0);
    expect(result.concordant).toBe(2);
    expect(result.discordant).toBe(2);
  });

  it("ignores unobserved features (nulls)", () => {
    const profile = [
      { featureId: "A", expectedStates: ["YES"], weight: 10, hallmark: false },
      { featureId: "B", expectedStates: ["YES"], weight: 1, hallmark: false },
      { featureId: "C", expectedStates: ["YES"], weight: 1, hallmark: false },
    ];
    const observed = { A: "YES", B: null, C: null };
    const result = computeFitScore(profile, observed);
    expect(result.status).toBe("SUFFICIENT");
    expect(result.score).not.toBeNull();

    const tooSparse = { A: null, B: "YES", C: null };
    const result2 = computeFitScore(profile, tooSparse);
    expect(result2.status).toBe("INSUFFICIENT_OBSERVATIONS");
    expect(result2.score).toBeNull();
  });

  it("returns null if coverage < 30%", () => {
    const profile = [
      { featureId: "A", expectedStates: ["YES"], weight: 10, hallmark: false },
      { featureId: "B", expectedStates: ["YES"], weight: 1, hallmark: false },
    ];
    const observed = { A: "YES", B: null };
    const result = computeFitScore(profile, observed);
    expect(result.status).toBe("SUFFICIENT");
    expect(result.score).not.toBeNull();

    const tooSparse = { A: null, B: "YES" };
    const result2 = computeFitScore(profile, tooSparse);
    expect(result2.status).toBe("INSUFFICIENT_OBSERVATIONS");
    expect(result2.score).toBeNull();
  });

  it("applies hallmark penalty multiplicatively", () => {
    const profile = [
      { featureId: "A", expectedStates: ["YES"], weight: 1, hallmark: true },
      { featureId: "B", expectedStates: ["YES"], weight: 1, hallmark: true },
      { featureId: "C", expectedStates: ["YES"], weight: 1, hallmark: false },
    ];
    const observed = { A: "NO", B: "NO", C: "YES" };
    const result = computeFitScore(profile, observed);
    expect(result.score).toBeCloseTo(0.0);
    expect(result.hallmarkPenaltyApplied).toBeCloseTo(0.25);
  });

  it("clamps fit_raw to [0, 1] before applying hallmark penalty", () => {
    const profile = [
      { featureId: "A", expectedStates: ["YES"], weight: 1, hallmark: false },
      { featureId: "B", expectedStates: ["YES"], weight: 2, hallmark: false },
    ];
    const observed = { A: "YES", B: "NO" };
    const result = computeFitScore(profile, observed);
    expect(result.score).toBeCloseTo(0.0);
  });

  it("handles multiple acceptable states for one feature", () => {
    const profile = [
      { featureId: "PAIN", expectedStates: ["SHARP", "PLEURITIC"], weight: 1, hallmark: false },
    ];
    const observed1 = { PAIN: "SHARP" };
    const result1 = computeFitScore(profile, observed1);
    expect(result1.concordant).toBe(1);

    const observed2 = { PAIN: "PLEURITIC" };
    const result2 = computeFitScore(profile, observed2);
    expect(result2.concordant).toBe(1);

    const observed3 = { PAIN: "DULL" };
    const result3 = computeFitScore(profile, observed3);
    expect(result3.discordant).toBe(1);
  });

  it("works with an empty profile", () => {
    const result = computeFitScore([], {});
    expect(result.status).toBe("INSUFFICIENT_OBSERVATIONS");
    expect(result.score).toBeNull();
  });
});