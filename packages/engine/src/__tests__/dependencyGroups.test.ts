import { describe, expect, it } from "vitest";
import { applyDependencyGroupDiscounts } from "../dependencyGroups.js";

describe("applyDependencyGroupDiscounts", () => {
  it("passes through standalone features (no dependency_group) unchanged", () => {
    const features = [{ featureId: "HR", rawLogLr: 1.5, dependencyGroup: null }];
    const { contributions } = applyDependencyGroupDiscounts(features);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]!.appliedWeight).toBe(1.0);
    expect(contributions[0]!.appliedLogLr).toBeCloseTo(1.5);
  });

  it("applies the first (largest) member of a group at full weight, rest at λ", () => {
    const features = [
      { featureId: "PLEURITIC", rawLogLr: 2.0, dependencyGroup: "PLEURITIC_CLUSTER" },
      { featureId: "SHARP", rawLogLr: 1.8, dependencyGroup: "PLEURITIC_CLUSTER" },
      { featureId: "WORSE_ON_INSPIRATION", rawLogLr: 1.6, dependencyGroup: "PLEURITIC_CLUSTER" },
    ];
    const { contributions } = applyDependencyGroupDiscounts(features);
    expect(contributions).toHaveLength(3);

    // PLEURITIC has the largest |log-LR| (2.0), so it gets weight 1.0.
    const pleuritic = contributions.find((c) => c.featureId === "PLEURITIC")!;
    expect(pleuritic.appliedWeight).toBe(1.0);
    expect(pleuritic.appliedLogLr).toBeCloseTo(2.0);

    // Others get discounted at default λ=0.35.
    const sharp = contributions.find((c) => c.featureId === "SHARP")!;
    expect(sharp.appliedWeight).toBeCloseTo(0.35);
    expect(sharp.appliedLogLr).toBeCloseTo(1.8 * 0.35);

    const worse = contributions.find((c) => c.featureId === "WORSE_ON_INSPIRATION")!;
    expect(worse.appliedWeight).toBeCloseTo(0.35);
    expect(worse.appliedLogLr).toBeCloseTo(1.6 * 0.35);
  });

  it("applies the largest |log-LR|, not the largest positive log-LR", () => {
    const features = [
      { featureId: "A", rawLogLr: 1.0, dependencyGroup: "TEST" },
      { featureId: "B", rawLogLr: -3.5, dependencyGroup: "TEST" }, // largest magnitude
      { featureId: "C", rawLogLr: 2.0, dependencyGroup: "TEST" },
    ];
    const { contributions } = applyDependencyGroupDiscounts(features);

    // B has the largest |log-LR| (3.5), gets full weight.
    const b = contributions.find((c) => c.featureId === "B")!;
    expect(b.appliedWeight).toBe(1.0);
    expect(b.appliedLogLr).toBeCloseTo(-3.5);

    // A and C get discounted.
    const a = contributions.find((c) => c.featureId === "A")!;
    expect(a.appliedWeight).toBeCloseTo(0.35);
    const c = contributions.find((c) => c.featureId === "C")!;
expect(c.appliedLogLr).toBeCloseTo(2.0 * 0.35);
  });

  it("respects custom redundancy_lambda per group", () => {
    const features = [
      { featureId: "P1", rawLogLr: 1.5, dependencyGroup: "GROUP_A" },
      { featureId: "P2", rawLogLr: 1.0, dependencyGroup: "GROUP_A" },
      { featureId: "Q1", rawLogLr: 2.0, dependencyGroup: "GROUP_B" },
      { featureId: "Q2", rawLogLr: 1.5, dependencyGroup: "GROUP_B" },
    ];
    const configs = {
      GROUP_A: { redundancyLambda: 0.2, rationale: "Highly correlated" },
      GROUP_B: { redundancyLambda: 0.7, rationale: "Weakly correlated" },
    };
    const { contributions } = applyDependencyGroupDiscounts(features, configs);

    // GROUP_A's second member gets λ=0.2.
    const p2 = contributions.find((c) => c.featureId === "P2")!;
    expect(p2.appliedWeight).toBeCloseTo(0.2);

    // GROUP_B's second member gets λ=0.7.
    const q2 = contributions.find((c) => c.featureId === "Q2")!;
    expect(q2.appliedWeight).toBeCloseTo(0.7);
  });

  it("handles multiple groups independently", () => {
    const features = [
      { featureId: "A1", rawLogLr: 1.0, dependencyGroup: "GROUP_A" },
      { featureId: "A2", rawLogLr: 0.8, dependencyGroup: "GROUP_A" },
      { featureId: "B1", rawLogLr: 2.0, dependencyGroup: "GROUP_B" },
      { featureId: "B2", rawLogLr: 1.5, dependencyGroup: "GROUP_B" },
    ];
    const { contributions, groups } = applyDependencyGroupDiscounts(features);

    expect(groups).toHaveLength(2);
    expect(groups.some((g) => g.groupId === "GROUP_A")).toBe(true);
    expect(groups.some((g) => g.groupId === "GROUP_B")).toBe(true);

    // Each group's largest gets full weight independently.
    const a1 = contributions.find((c) => c.featureId === "A1")!;
    expect(a1.appliedWeight).toBe(1.0);

    const b1 = contributions.find((c) => c.featureId === "B1")!;
    expect(b1.appliedWeight).toBe(1.0);

    // Their respective secondaries get discounted.
    const a2 = contributions.find((c) => c.featureId === "A2")!;
    expect(a2.appliedWeight).toBeCloseTo(0.35);

    const b2 = contributions.find((c) => c.featureId === "B2")!;
    expect(b2.appliedWeight).toBeCloseTo(0.35);
  });
});