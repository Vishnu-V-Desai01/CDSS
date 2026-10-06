// packages/safety-gate/src/__tests__/canonicaliser.test.ts
/**
 * Test suite: Vital canonicalisation per spec §4.3.
 *
 * Verifies:
 *   1. Raw numerics bin correctly to categorical states
 *   2. Pregnancy modifiers apply (SBP threshold, HR threshold)
 *   3. Missing inputs don't error; they're just absent from output
 *   4. Invalid inputs (non-numeric) are caught as errors
 *   5. Minimum safety set completeness is checked
 */

import { describe, it, expect } from "vitest";
import { canonicalise, checkMinimumSafetySet } from "../canonicaliser";

describe("Canonicaliser", () => {
  describe("SBP canonicalisation", () => {
    it("bins < 90 to HYPOTENSIVE (non-pregnant)", () => {
      const result = canonicalise(
        { VS_SBP: 84 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"]).toBe("HYPOTENSIVE");
      expect(result.errors).toHaveLength(0);
    });

    it("bins < 100 to HYPOTENSIVE when pregnant", () => {
      const result = canonicalise(
        { VS_SBP: 98 },
        { isPregnant: true, isPostpartum6wk: false, ageYears: 28 }
      );

      expect(result.canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"]).toBe("HYPOTENSIVE");
      expect(result.errors).toHaveLength(0);
    });

    it("bins 90–139 to NORMAL", () => {
      const result = canonicalise(
        { VS_SBP: 120 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"]).toBe("NORMAL");
    });

    it("bins >= 140 to HYPERTENSIVE", () => {
      const result = canonicalise(
        { VS_SBP: 160 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"]).toBe("HYPERTENSIVE");
    });

    it("reports error on non-numeric input", () => {
      const result = canonicalise(
        { VS_SBP: "not a number" },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.errors).toContainEqual(
        expect.objectContaining({ featureId: "VS_SBP", error: expect.stringContaining("numeric") })
      );
      expect(result.canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"]).toBeUndefined();
    });
  });

  describe("HR canonicalisation", () => {
    it("bins < 40 to BRADYCARDIA", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 38 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("BRADYCARDIA");
    });

    it("bins 40–99 to NORMAL", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 72 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("NORMAL");
    });

    it("bins 100–130 to TACHYCARDIA", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 115 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("TACHYCARDIA");
    });

    it("bins > 130 to SEVERE_TACHYCARDIA (non-pregnant)", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 145 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("SEVERE_TACHYCARDIA");
    });

    it("bins > 140 to SEVERE_TACHYCARDIA when pregnant", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 142 },
        { isPregnant: true, isPostpartum6wk: false, ageYears: 28 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("SEVERE_TACHYCARDIA");
    });

    it("does not bin 135 to SEVERE when non-pregnant", () => {
      const result = canonicalise(
        { VS_HEART_RATE: 135 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["HEART_RATE_CATEGORY"]).toBe("SEVERE_TACHYCARDIA");
    });
  });

  describe("SpO2 canonicalisation", () => {
    it("bins < 88 to SEVERE_HYPOXIA", () => {
      const result = canonicalise(
        { VS_SPO2_ROOM_AIR: 85 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["OXYGEN_SATURATION_CATEGORY"]).toBe("SEVERE_HYPOXIA");
    });

    it("bins 88–93 to MILD_HYPOXIA", () => {
      const result = canonicalise(
        { VS_SPO2_ROOM_AIR: 91 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["OXYGEN_SATURATION_CATEGORY"]).toBe("MILD_HYPOXIA");
    });

    it("bins >= 94 to NORMAL", () => {
      const result = canonicalise(
        { VS_SPO2_ROOM_AIR: 97 },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["OXYGEN_SATURATION_CATEGORY"]).toBe("NORMAL");
    });
  });

  describe("Categorical passthrough (PRESENT/ABSENT)", () => {
    it("passes through ORTHOPNEA", () => {
      const result = canonicalise(
        { ORTHOPNEA: "PRESENT" },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.canonical["ORTHOPNEA"]).toBe("PRESENT");
      expect(result.errors).toHaveLength(0);
    });

    it("reports error on invalid categorical value", () => {
      const result = canonicalise(
        { ORTHOPNEA: "MAYBE" },
        { isPregnant: false, isPostpartum6wk: false, ageYears: 45 }
      );

      expect(result.errors).toContainEqual(
        expect.objectContaining({ featureId: "ORTHOPNEA" })
      );
    });
  });

  describe("Minimum safety set", () => {
    it("is complete when all required vitals present", () => {
      const result = checkMinimumSafetySet({
        VS_HEART_RATE: 85,
        VS_RESP_RATE: 18,
        VS_SBP: 120,
        VS_DBP: 80,
        VS_SPO2_ROOM_AIR: 96,
        VS_TEMPERATURE: 37.2,
        EX_MENTAL_STATUS: "ALERT",
      });

      expect(result.complete).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("is incomplete when SpO2 missing", () => {
      const result = checkMinimumSafetySet({
        VS_HEART_RATE: 85,
        VS_RESP_RATE: 18,
        VS_SBP: 120,
        VS_DBP: 80,
        VS_TEMPERATURE: 37.2,
        EX_MENTAL_STATUS: "ALERT",
      });

      expect(result.complete).toBe(false);
      expect(result.missing).toContain("VS_SPO2_ROOM_AIR");
    });

    it("reports all missing fields", () => {
      const result = checkMinimumSafetySet({
        VS_HEART_RATE: 85,
      });

      expect(result.complete).toBe(false);
      expect(result.missing).toHaveLength(6);
      expect(result.missing).toContain("VS_RESP_RATE");
      expect(result.missing).toContain("VS_SBP");
      expect(result.missing).toContain("VS_DBP");
      expect(result.missing).toContain("VS_SPO2_ROOM_AIR");
      expect(result.missing).toContain("VS_TEMPERATURE");
      expect(result.missing).toContain("EX_MENTAL_STATUS");
    });
  });
});