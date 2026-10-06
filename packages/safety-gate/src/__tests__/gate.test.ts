// packages/safety-gate/src/__tests__/gate.test.ts
/**
 * Test suite: Safety gate red-flag evaluation.
 *
 * One test per rule. Verification:
 *   1. Rule fires when all triggers match (trigger_logic ALL/ANY)
 *   2. Rule does not fire when condition not met
 *   3. Rule is unevaluable when inputs missing
 *
 * Acceptance criterion (from brief): "Every red flag in red-flags.yaml triggers
 * HALT in a test, and HALT responses contain no differential."
 */

import { describe, it, expect } from "vitest";
import { evaluateGate, type GateResult } from "../gate";
import type { RedFlagRule } from "@cds/shared-types";

describe("Safety Gate — Red Flag Evaluation", () => {
  describe("RF-01: Haemodynamic Collapse", () => {
    const rf01: RedFlagRule = {
      flag_id: "RF-01",
      display_name: "Haemodynamic Collapse",
      clinical_rationale:
        "Systolic BP < 90 mmHg with severe tachycardia (HR > 130) indicates cardiogenic shock",
      triggers: [
        {
          finding_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
          required_state: "HYPOTENSIVE",
          description: "Systolic BP < 90 mmHg",
        },
        {
          finding_id: "HEART_RATE_CATEGORY",
          required_state: "SEVERE_TACHYCARDIA",
          description: "Heart rate > 130 bpm",
        },
      ],
      trigger_logic: "ALL",
      halt_message: "Haemodynamic collapse detected. Initiate resuscitation.",
      confidence: "CERTAIN",
    };

    it("fires when SBP hypotensive AND HR severe tachycardia", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-01": rf01 },
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toContain("RF-01");
      expect(result.primaryRule).toBe("RF-01");
    });

    it("does not fire when only SBP is hypotensive", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          HEART_RATE_CATEGORY: "TACHYCARDIA",
        },
        redFlags: { "RF-01": rf01 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.firedRules).not.toContain("RF-01");
    });

    it("does not fire when only HR is severe tachycardia", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "NORMAL",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-01": rf01 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.firedRules).not.toContain("RF-01");
    });

    it("is unevaluable when HR is missing", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
        },
        redFlags: { "RF-01": rf01 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-01",
        missingFeatures: ["HEART_RATE_CATEGORY"],
      });
    });

    it("is unevaluable when SBP is missing", () => {
      const result = evaluateGate({
        evidence: {
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-01": rf01 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-01",
        missingFeatures: ["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"],
      });
    });
  });

  describe("RF-02: Massive PE Suspected", () => {
    const rf02: RedFlagRule = {
      flag_id: "RF-02",
      display_name: "Massive PE Suspected",
      clinical_rationale:
        "Syncope with severe hypoxia and severe tachycardia suggest acute RV strain",
      triggers: [
        {
          finding_id: "SYNCOPE",
          required_state: "PRESENT",
          description: "Syncopal episode",
        },
        {
          finding_id: "OXYGEN_SATURATION_CATEGORY",
          required_state: "SEVERE_HYPOXIA",
          description: "SpO2 < 88%",
        },
        {
          finding_id: "HEART_RATE_CATEGORY",
          required_state: "SEVERE_TACHYCARDIA",
          description: "Heart rate > 130 bpm",
        },
      ],
      trigger_logic: "ALL",
      halt_message: "Massive PE suspected. Activate emergency thrombectomy protocol.",
      confidence: "CERTAIN",
    };

    it("fires when syncope AND severe hypoxia AND severe tachycardia", () => {
      const result = evaluateGate({
        evidence: {
          SYNCOPE: "PRESENT",
          OXYGEN_SATURATION_CATEGORY: "SEVERE_HYPOXIA",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-02": rf02 },
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toContain("RF-02");
    });

    it("does not fire when syncope absent", () => {
      const result = evaluateGate({
        evidence: {
          SYNCOPE: "ABSENT",
          OXYGEN_SATURATION_CATEGORY: "SEVERE_HYPOXIA",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-02": rf02 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.firedRules).not.toContain("RF-02");
    });

    it("does not fire when SpO2 is only mild hypoxia", () => {
      const result = evaluateGate({
        evidence: {
          SYNCOPE: "PRESENT",
          OXYGEN_SATURATION_CATEGORY: "MILD_HYPOXIA",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-02": rf02 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.firedRules).not.toContain("RF-02");
    });

    it("is unevaluable when SpO2 is missing", () => {
      const result = evaluateGate({
        evidence: {
          SYNCOPE: "PRESENT",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
        },
        redFlags: { "RF-02": rf02 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-02",
        missingFeatures: ["OXYGEN_SATURATION_CATEGORY"],
      });
    });
  });

  describe("RF-03: Acute ST-Elevation MI", () => {
    const rf03: RedFlagRule = {
      flag_id: "RF-03",
      display_name: "Acute ST-Elevation MI",
      clinical_rationale:
        "ST elevation indicates acute transmural infarction requiring emergency reperfusion",
      triggers: [
        {
          finding_id: "ECG_ST_ELEVATION",
          required_state: "PRESENT",
          description: "ST elevation ≥1mm in contiguous leads",
        },
      ],
      trigger_logic: "ANY",
      halt_message: "Acute STEMI detected. Activate STEMI protocol: urgent PCI or thrombolysis.",
      confidence: "CERTAIN",
    };

    it("fires when ST elevation present", () => {
      const result = evaluateGate({
        evidence: {
          ECG_ST_ELEVATION: "PRESENT",
        },
        redFlags: { "RF-03": rf03 },
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toContain("RF-03");
      expect(result.primaryRule).toBe("RF-03");
    });

    it("does not fire when ST elevation absent", () => {
      const result = evaluateGate({
        evidence: {
          ECG_ST_ELEVATION: "ABSENT",
        },
        redFlags: { "RF-03": rf03 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.firedRules).not.toContain("RF-03");
    });

    it("is unevaluable when ECG result missing", () => {
      const result = evaluateGate({
        evidence: {},
        redFlags: { "RF-03": rf03 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-03",
        missingFeatures: ["ECG_ST_ELEVATION"],
      });
    });
  });

  describe("RF-04: Acute Pulmonary Edema with Respiratory Failure", () => {
    const rf04: RedFlagRule = {
      flag_id: "RF-04",
      display_name: "Acute Pulmonary Edema with Respiratory Failure",
      clinical_rationale:
        "Orthopnea, rales, and severe hypoxia indicate acute decompensated heart failure",
      triggers: [
        {
          finding_id: "ORTHOPNEA",
          required_state: "PRESENT",
          description: "Breathlessness when lying flat",
        },
        {
          finding_id: "PULMONARY_RALES",
          required_state: "PRESENT",
          description: "Bibasal crackles on auscultation",
        },
        {
          finding_id: "OXYGEN_SATURATION_CATEGORY",
          required_state: "SEVERE_HYPOXIA",
          description: "SpO2 < 88%",
        },
      ],
      trigger_logic: "ALL",
      halt_message:
        "Acute decompensated heart failure with pulmonary edema. High-flow O2, IV diuretics, urgent cardiology.",
      confidence: "CERTAIN",
    };

    it("fires when orthopnea AND rales AND severe hypoxia", () => {
      const result = evaluateGate({
        evidence: {
          ORTHOPNEA: "PRESENT",
          PULMONARY_RALES: "PRESENT",
          OXYGEN_SATURATION_CATEGORY: "SEVERE_HYPOXIA",
        },
        redFlags: { "RF-04": rf04 },
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toContain("RF-04");
    });

    it("does not fire when rales absent", () => {
      const result = evaluateGate({
        evidence: {
          ORTHOPNEA: "PRESENT",
          PULMONARY_RALES: "ABSENT",
          OXYGEN_SATURATION_CATEGORY: "SEVERE_HYPOXIA",
        },
        redFlags: { "RF-04": rf04 },
      });

      expect(result.status).toBe("PROCEED");
    });

    it("is unevaluable when orthopnea missing", () => {
      const result = evaluateGate({
        evidence: {
          PULMONARY_RALES: "PRESENT",
          OXYGEN_SATURATION_CATEGORY: "SEVERE_HYPOXIA",
        },
        redFlags: { "RF-04": rf04 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-04",
        missingFeatures: ["ORTHOPNEA"],
      });
    });
  });

  describe("RF-05: Pericardial Tamponade", () => {
    const rf05: RedFlagRule = {
      flag_id: "RF-05",
      display_name: "Pericardial Tamponade",
      clinical_rationale:
        "Beck's triad (hypotension, elevated JVP, muffled sounds) indicates cardiac tamponade",
      triggers: [
        {
          finding_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
          required_state: "HYPOTENSIVE",
          description: "Systolic BP < 90 mmHg",
        },
        {
          finding_id: "JVD",
          required_state: "PRESENT",
          description: "Jugular venous distension",
        },
        {
          finding_id: "MUFFLED_HEART_SOUNDS",
          required_state: "PRESENT",
          description: "Muffled or distant heart sounds",
        },
      ],
      trigger_logic: "ALL",
      halt_message: "Pericardial tamponade suspected (Beck's triad). Emergency pericardiocentesis required.",
      confidence: "CERTAIN",
    };

    it("fires when hypotension AND JVD AND muffled sounds", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          JVD: "PRESENT",
          MUFFLED_HEART_SOUNDS: "PRESENT",
        },
        redFlags: { "RF-05": rf05 },
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toContain("RF-05");
    });

    it("does not fire when JVD absent", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          JVD: "ABSENT",
          MUFFLED_HEART_SOUNDS: "PRESENT",
        },
        redFlags: { "RF-05": rf05 },
      });

      expect(result.status).toBe("PROCEED");
    });

    it("is unevaluable when muffled sounds missing", () => {
      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          JVD: "PRESENT",
        },
        redFlags: { "RF-05": rf05 },
      });

      expect(result.status).toBe("PROCEED");
      expect(result.unevaluableRules).toContainEqual({
        ruleId: "RF-05",
        missingFeatures: ["MUFFLED_HEART_SOUNDS"],
      });
    });
  });

  describe("Multiple rules: order independence and all-fired reporting", () => {
    it("returns all fired rules in ascending ID order", () => {
      const rules: Record<string, RedFlagRule> = {
        "RF-01": {
          flag_id: "RF-01",
          display_name: "Haemodynamic Collapse",
          clinical_rationale: "...",
          triggers: [
            { finding_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY", required_state: "HYPOTENSIVE", description: "" },
            { finding_id: "HEART_RATE_CATEGORY", required_state: "SEVERE_TACHYCARDIA", description: "" },
          ],
          trigger_logic: "ALL",
          halt_message: "RF-01",
          confidence: "CERTAIN",
        },
        "RF-03": {
          flag_id: "RF-03",
          display_name: "ST Elevation",
          clinical_rationale: "...",
          triggers: [{ finding_id: "ECG_ST_ELEVATION", required_state: "PRESENT", description: "" }],
          trigger_logic: "ANY",
          halt_message: "RF-03",
          confidence: "CERTAIN",
        },
      };

      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
          HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
          ECG_ST_ELEVATION: "PRESENT",
        },
        redFlags: rules,
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toEqual(["RF-01", "RF-03"]);
      expect(result.primaryRule).toBe("RF-01"); // lowest ID
    });

    it("does not proceed if any single rule fires", () => {
      const rules: Record<string, RedFlagRule> = {
        "RF-01": {
          flag_id: "RF-01",
          display_name: "Haemodynamic Collapse",
          clinical_rationale: "...",
          triggers: [
            { finding_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY", required_state: "HYPOTENSIVE", description: "" },
            { finding_id: "HEART_RATE_CATEGORY", required_state: "SEVERE_TACHYCARDIA", description: "" },
          ],
          trigger_logic: "ALL",
          halt_message: "RF-01",
          confidence: "CERTAIN",
        },
        "RF-03": {
          flag_id: "RF-03",
          display_name: "ST Elevation",
          clinical_rationale: "...",
          triggers: [{ finding_id: "ECG_ST_ELEVATION", required_state: "PRESENT", description: "" }],
          trigger_logic: "ANY",
          halt_message: "RF-03",
          confidence: "CERTAIN",
        },
      };

      const result = evaluateGate({
        evidence: {
          SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "NORMAL",
          HEART_RATE_CATEGORY: "NORMAL",
          ECG_ST_ELEVATION: "PRESENT", // only this one fires
        },
        redFlags: rules,
      });

      expect(result.status).toBe("HALT");
      expect(result.firedRules).toEqual(["RF-03"]);
    });
  });
});