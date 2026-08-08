import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.js";

describe("evaluate", () => {
  it("computes posteriors for a minimal two-hypothesis case", () => {
    const input = {
      conditions: [
        {
          id: "DISEASE_A",
          priors: { TEST_SETTING: 0.3 },
          features: [
            {
              id: "SYMPTOM_X",
              dependencyGroup: null,
              lrs: { PRESENT: 2.0, ABSENT: 0.5 },
            },
          ],
          expectedProfile: [
            { featureId: "SYMPTOM_X", expectedStates: ["PRESENT"], weight: 1, hallmark: false },
          ],
          dependencyGroups: {},
        },
        {
          id: "DISEASE_B",
          priors: { TEST_SETTING: 0.7 },
          features: [
            {
              id: "SYMPTOM_X",
              dependencyGroup: null,
              lrs: { PRESENT: 0.3, ABSENT: 1.5 },
            },
          ],
          expectedProfile: [
            { featureId: "SYMPTOM_X", expectedStates: ["ABSENT"], weight: 1, hallmark: false },
          ],
          dependencyGroups: {},
        },
      ],
      careSetting: "TEST_SETTING",
      evidence: { SYMPTOM_X: "PRESENT" },
    };

    const result = evaluate(input);
    expect(result.hypotheses).toHaveLength(2);
    expect(result.normalised).toBe(true);

    const a = result.hypotheses.find((h) => h.id === "DISEASE_A")!;
    const b = result.hypotheses.find((h) => h.id === "DISEASE_B")!;

    // DISEASE_A has prior 0.3 and LR 2.0 for observed symptom.
    // DISEASE_B has prior 0.7 but LR 0.3 (against the observation).
    // So A should be more likely than B after evidence.
    expect(a.probability).toBeGreaterThan(b.probability);
    expect(a.probability + b.probability).toBeCloseTo(1.0);
  });

  it("handles unobserved features (no evidence = no LR applied)", () => {
    const input = {
      conditions: [
        {
          id: "COND_1",
          priors: { TEST: 0.5 },
          features: [
            {
              id: "OBSERVED_FEATURE",
              dependencyGroup: null,
              lrs: { YES: 2.0, NO: 0.5 },
            },
            {
              id: "UNOBSERVED_FEATURE",
              dependencyGroup: null,
              lrs: { YES: 5.0, NO: 0.1 },
            },
          ],
          expectedProfile: [],
          dependencyGroups: {},
        },
        {
          id: "COND_2",
          priors: { TEST: 0.5 },
          features: [],
          expectedProfile: [],
          dependencyGroups: {},
        },
      ],
      careSetting: "TEST",
      evidence: { OBSERVED_FEATURE: "YES" },
    };

    const result = evaluate(input);
    expect(result.hypotheses).toHaveLength(2);
    const cond = result.hypotheses.find((h) => h.id === "COND_1")!;
    expect(cond.probability).toBeGreaterThan(0.5);
    expect(cond.topContributors).toHaveLength(1);
    expect(cond.topContributors[0]!.featureId).toBe("OBSERVED_FEATURE");
  });

  it("rejects missing prior for a condition in the given care_setting", () => {
    const input = {
      conditions: [
        {
          id: "COND",
          priors: { SETTING_A: 1.0 },
          features: [],
          expectedProfile: [],
          dependencyGroups: {},
        },
      ],
      careSetting: "SETTING_B",
      evidence: {},
    };

    expect(() => evaluate(input)).toThrow(/no prior for care_setting/);
  });

  it("probabilities sum to 1.0 across multiple conditions", () => {
    const input = {
      conditions: [
        {
          id: "A",
          priors: { TEST: 0.2 },
          features: [
            { id: "F1", dependencyGroup: null, lrs: { Y: 3.0, N: 0.5 } },
          ],
          expectedProfile: [],
          dependencyGroups: {},
        },
        {
          id: "B",
          priors: { TEST: 0.3 },
          features: [
            { id: "F1", dependencyGroup: null, lrs: { Y: 1.5, N: 1.2 } },
          ],
          expectedProfile: [],
          dependencyGroups: {},
        },
        {
          id: "C",
          priors: { TEST: 0.5 },
          features: [
            { id: "F1", dependencyGroup: null, lrs: { Y: 0.8, N: 1.8 } },
          ],
          expectedProfile: [],
          dependencyGroups: {},
        },
      ],
      careSetting: "TEST",
      evidence: { F1: "Y" },
    };

    const result = evaluate(input);
    expect(result.hypotheses).toHaveLength(3);
    const probSum = result.hypotheses.reduce((sum, h) => sum + h.probability, 0);
    expect(probSum).toBeCloseTo(1.0);
  });

  it("computes fit scores alongside probabilities", () => {
    const input = {
      conditions: [
        {
          id: "COND_1",
          priors: { TEST: 0.6 },
          features: [
            { id: "F1", dependencyGroup: null, lrs: { Y: 2.0, N: 0.5 } },
          ],
          expectedProfile: [
            { featureId: "F1", expectedStates: ["Y"], weight: 1, hallmark: false },
          ],
          dependencyGroups: {},
        },
        {
          id: "COND_2",
          priors: { TEST: 0.4 },
          features: [],
          expectedProfile: [],
          dependencyGroups: {},
        },
      ],
      careSetting: "TEST",
      evidence: { F1: "Y" },
    };

    const result = evaluate(input);
    const cond = result.hypotheses.find((h) => h.id === "COND_1")!;
    expect(cond.fitScore).not.toBeNull();
    expect(cond.fitScore).toBe(1.0);
  });
});