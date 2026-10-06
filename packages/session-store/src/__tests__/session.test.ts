// packages/session-store/src/__tests__/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store.js";
import { SessionManager, type BaseEngineConfig } from "../session.js";
import type { FeatureRegistryFile, RedFlagRule } from "@cds/shared-types";

describe("Session Manager", () => {
  let manager: SessionManager;
  let store: MemoryStore;

  // careSetting is deliberately absent: it comes from each session's metadata.
  const mockEngineConfig: BaseEngineConfig = {
    conditions: [
      {
        id: "PE",
        priors: { ED_UNDIFFERENTIATED_CHEST_PAIN: 0.04 },
        features: [],
        expectedProfile: [],
        dependencyGroups: {},
      },
      {
        id: "CHF",
        priors: { ED_UNDIFFERENTIATED_CHEST_PAIN: 0.06 },
        features: [],
        expectedProfile: [],
        dependencyGroups: {},
      },
    ],
    inScopeConditionIds: ["PE", "CHF"],
    featureMeta: {},
    resolveCitation: () => null,
  };

  const mockRedFlags: Record<string, RedFlagRule> = {
    "RF-01": {
      flag_id: "RF-01",
      display_name: "Haemodynamic Collapse",
      clinical_rationale: "Shock physiology",
      triggers: [
        {
          finding_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
          required_state: "HYPOTENSIVE",
          description: "Systolic pressure is low",
        },
        {
          finding_id: "HEART_RATE_CATEGORY",
          required_state: "SEVERE_TACHYCARDIA",
          description: "Heart rate is severely raised",
        },
      ],
      trigger_logic: "ALL",
      halt_message: "Haemodynamic collapse",
      confidence: "CERTAIN",
    },
  };

  // Every finding a red-flag rule can wait on needs wording, because the
  // session now serves it from the registry.
  const mockRegistry: FeatureRegistryFile = {
    SYSTOLIC_BLOOD_PRESSURE_CATEGORY: {
      feature_id: "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
      prompt: "Systolic blood pressure category",
      tier: "BEDSIDE",
      dependency_group: null,
      state_values: ["HYPOTENSIVE", "NORMAL", "HYPERTENSIVE"],
    },
    HEART_RATE_CATEGORY: {
      feature_id: "HEART_RATE_CATEGORY",
      prompt: "Heart rate category",
      tier: "BEDSIDE",
      dependency_group: null,
      state_values: ["BRADYCARDIA", "NORMAL", "TACHYCARDIA", "SEVERE_TACHYCARDIA"],
    },
  };

  const newSession = () =>
    manager.createSession({
      careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
      patientAge: 45,
      patientSex: "MALE",
    });

  const sbp = (value: string, rawValue: number) => ({
    featureId: "VS_SBP",
    value,
    rawValue,
    source: "MEASURED" as const,
    observedAt: new Date().toISOString(),
    observerConfidence: "HIGH" as const,
  });

  const hr = (value: string, rawValue: number) => ({
    featureId: "VS_HEART_RATE",
    value,
    rawValue,
    source: "MEASURED" as const,
    observedAt: new Date().toISOString(),
    observerConfidence: "HIGH" as const,
  });

  beforeEach(() => {
    store = new MemoryStore();
    // These tests never complete the minimum safety set, so the inference
    // step is never reached.
    manager = new SessionManager(store, mockEngineConfig, mockRedFlags, mockRegistry);
  });

  describe("Session creation", () => {
    it("creates a new session with empty evidence log", async () => {
      const session = await newSession();

      expect(session.metadata.sessionId).toBeDefined();
      expect(session.metadata.createdAt).toBeDefined();
      expect(session.turn).toBe(0);
      expect(session.evidenceLog).toHaveLength(0);
      expect(session.halted).toBe(false);
      expect(session.halt).toBeNull();
      expect(session.distribution).toBeNull();
      expect(session.lastMovement).toBeNull();
      expect(session.deferredFeatureIds).toEqual([]);
      expect(session.trace).toEqual([]);
    });

    it("starts with all seven safety-set vitals missing", async () => {
      const session = await newSession();

      expect(session.minimumSafetySet.complete).toBe(false);
      expect([...session.minimumSafetySet.missing].sort()).toEqual([
        "EX_MENTAL_STATUS",
        "VS_DBP",
        "VS_HEART_RATE",
        "VS_RESP_RATE",
        "VS_SBP",
        "VS_SPO2_ROOM_AIR",
        "VS_TEMPERATURE",
      ]);
    });

    it("lists every red-flag check waiting on a finding, with wording", async () => {
      const session = await newSession();

      expect(session.redFlagChecks).toHaveLength(1);
      const check = session.redFlagChecks[0]!;
      expect(check.ruleId).toBe("RF-01");
      expect(check.displayName).toBe("Haemodynamic Collapse");
      expect(check.missingFindings.map((f) => f.featureId).sort()).toEqual([
        "HEART_RATE_CATEGORY",
        "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
      ]);
      for (const f of check.missingFindings) {
        expect(f.prompt.length).toBeGreaterThan(0);
        expect(f.stateValues.length).toBeGreaterThan(0);
        // Both are derived from raw vitals, so they are not directly answerable.
        expect(f.answerable).toBe(false);
      }
    });
  });

  describe("Evidence submission", () => {
    it("appends evidence to the log", async () => {
      const session = await newSession();

      const updated = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("NORMAL", 85)
      );

      expect(updated.evidenceLog).toHaveLength(1);
      expect(updated.evidenceLog[0]!.featureId).toBe("VS_HEART_RATE");
      expect(updated.evidenceLog[0]!.value).toBe("NORMAL");
    });

    it("records each submission as an append-only trace event", async () => {
      const session = await newSession();
      const updated = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("NORMAL", 85)
      );

      expect(updated.trace).toHaveLength(1);
      const rec = updated.trace[0]!;
      expect(rec.seq).toBe(0);
      expect(rec.kind).toBe("EVIDENCE_ADDED");
      expect(rec.featureId).toBe("VS_HEART_RATE");
      expect(rec.evidenceId).toBe(updated.evidenceLog[0]!.id);
      // No differential exists yet, so there is nothing to compare.
      expect(rec.before).toBeNull();
      expect(rec.after).toBeNull();
    });

    it("halts on red flag and locks session", async () => {
      const session = await newSession();

      const updated = await manager.submitEvidence(
        session.metadata.sessionId,
        sbp("HYPOTENSIVE", 84)
      );
      expect(updated.halted).toBe(false);

      const final = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      expect(final.halted).toBe(true);
      expect(final.haltRule).toBe("RF-01");
    });

    it("a halted session carries no differential, question, or pending queue", async () => {
      const session = await newSession();
      await manager.submitEvidence(session.metadata.sessionId, sbp("HYPOTENSIVE", 84));
      const final = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      expect(final.halted).toBe(true);
      expect(final.distribution).toBeNull();
      expect(final.nextQuestion).toBeNull();
      expect(final.pending).toEqual([]);
      expect(final.lastMovement).toBeNull();
      expect(final.redFlagChecks).toEqual([]);
      // Turn is incremented on the halt path, so it matches the evidence log.
      expect(final.turn).toBe(2);
    });

    it("a halted session explains which rule fired and why", async () => {
      const session = await newSession();
      await manager.submitEvidence(session.metadata.sessionId, sbp("HYPOTENSIVE", 84));
      const final = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      expect(final.halt).not.toBeNull();
      expect(final.halt!.primaryRule).toBe("RF-01");
      const rule = final.halt!.rules[0]!;
      expect(rule.displayName).toBe("Haemodynamic Collapse");
      expect(rule.haltMessage).toBe("Haemodynamic collapse");
      expect(rule.triggers).toHaveLength(2);
      expect(rule.triggers.every((t) => t.matched)).toBe(true);
      expect(rule.triggers.map((t) => t.observedState).sort()).toEqual([
        "HYPOTENSIVE",
        "SEVERE_TACHYCARDIA",
      ]);
      expect(final.trace.map((t) => t.kind)).toEqual([
        "EVIDENCE_ADDED",
        "EVIDENCE_ADDED",
        "SESSION_HALTED",
      ]);
    });

    it("rejects evidence submission to halted session", async () => {
      const session = await newSession();
      await manager.submitEvidence(session.metadata.sessionId, sbp("HYPOTENSIVE", 84));
      await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      await expect(
        manager.submitEvidence(session.metadata.sessionId, {
          featureId: "ORTHOPNEA",
          value: "ABSENT",
          source: "PATIENT_REPORTED",
          observedAt: new Date().toISOString(),
          observerConfidence: "MEDIUM",
        })
      ).rejects.toThrow("halted");
    });

    it("a rejected value is not persisted, so the session stays usable", async () => {
      const session = await newSession();
      const id = session.metadata.sessionId;

      await expect(
        manager.submitEvidence(id, {
          featureId: "VS_HEART_RATE",
          value: "abc",
          rawValue: "abc",
          source: "MEASURED",
          observedAt: new Date().toISOString(),
          observerConfidence: "HIGH",
        })
      ).rejects.toThrow(/Canonicalisation failed/);

      const afterReject = (await manager.getSession(id))!;
      expect(afterReject.evidenceLog).toHaveLength(0);
      expect(afterReject.trace).toHaveLength(0);

      const ok = await manager.submitEvidence(id, hr("NORMAL", 85));
      expect(ok.evidenceLog).toHaveLength(1);
    });
  });

  describe("Evidence correction (retract + replay)", () => {
    it("retraction clears evidence entry and replays", async () => {
      let session = await newSession();

      session = await manager.submitEvidence(
        session.metadata.sessionId,
        sbp("HYPOTENSIVE", 85)
      );
      session = await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      expect(session.halted).toBe(true);
      const sbpEntryId = session.evidenceLog.find((e) => e.featureId === "VS_SBP")!.id;

      const corrected = await manager.correctEvidence(
        session.metadata.sessionId,
        sbpEntryId,
        {
          evidenceId: sbpEntryId,
          ...sbp("HYPERTENSIVE", 150),
        }
      );

      expect(corrected.halted).toBe(false);
      expect(corrected.halt).toBeNull();
      expect(corrected.evidenceLog.length).toBeGreaterThan(2);
      expect(corrected.evidenceLog.some((e) => e.corrects === sbpEntryId)).toBe(true);
    });

    it("a correction appends to the trace and never rewrites earlier records", async () => {
      let session = await newSession();
      const id = session.metadata.sessionId;

      session = await manager.submitEvidence(id, sbp("HYPOTENSIVE", 85));
      session = await manager.submitEvidence(id, hr("SEVERE_TACHYCARDIA", 145));
      const sbpEntryId = session.evidenceLog.find((e) => e.featureId === "VS_SBP")!.id;

      const snapshot = JSON.parse(JSON.stringify(session.trace));
      expect(snapshot).toHaveLength(3);

      const corrected = await manager.correctEvidence(id, sbpEntryId, {
        evidenceId: sbpEntryId,
        ...sbp("HYPERTENSIVE", 150),
      });

      // The first three records are byte-for-byte what they were.
      expect(corrected.trace.slice(0, 3)).toEqual(snapshot);
      expect(corrected.trace.map((t) => t.kind)).toEqual([
        "EVIDENCE_ADDED",
        "EVIDENCE_ADDED",
        "SESSION_HALTED",
        "EVIDENCE_CORRECTED",
        "HALT_CLEARED",
      ]);
      expect(corrected.trace.map((t) => t.seq)).toEqual([0, 1, 2, 3, 4]);

      const rec = corrected.trace[3]!;
      expect(rec.corrects).toBe(sbpEntryId);
      expect(rec.previousValue).toBe("HYPOTENSIVE");
      expect(rec.value).toBe("HYPERTENSIVE");
    });

    it("a rejected correction is not persisted", async () => {
      let session = await newSession();
      const id = session.metadata.sessionId;
      session = await manager.submitEvidence(id, hr("NORMAL", 85));
      const entryId = session.evidenceLog[0]!.id;

      await expect(
        manager.correctEvidence(id, entryId, {
          evidenceId: entryId,
          featureId: "VS_HEART_RATE",
          value: "abc",
          rawValue: "abc",
          source: "MEASURED",
          observedAt: new Date().toISOString(),
          observerConfidence: "HIGH",
        })
      ).rejects.toThrow(/Canonicalisation failed/);

      const after = (await manager.getSession(id))!;
      expect(after.evidenceLog).toHaveLength(1);
      expect(after.trace).toHaveLength(1);
    });
  });

  describe("Deferral", () => {
    it("records a deferral with its turn, without producing a differential early", async () => {
      const session = await newSession();

      const updated = await manager.deferQuestion(
        session.metadata.sessionId,
        "ECG_ST_ELEVATION"
      );

      expect(updated.deferredFeatureIds).toContainEqual({
        featureId: "ECG_ST_ELEVATION",
        deferredAtTurn: 1,
      });
      // Minimum safety set not met, so no differential yet.
      expect(updated.distribution).toBeNull();
      expect(updated.trace).toHaveLength(1);
      expect(updated.trace[0]!.kind).toBe("QUESTION_DEFERRED");
      expect(updated.trace[0]!.featureId).toBe("ECG_ST_ELEVATION");
    });

    it("deferring the same question twice records it once", async () => {
      const session = await newSession();
      await manager.deferQuestion(session.metadata.sessionId, "ECG_ST_ELEVATION");
      const again = await manager.deferQuestion(
        session.metadata.sessionId,
        "ECG_ST_ELEVATION"
      );

      expect(again.deferredFeatureIds).toHaveLength(1);
      expect(again.trace).toHaveLength(1);
    });

    it("does not allow deferral on halted session", async () => {
      const session = await newSession();
      await manager.submitEvidence(session.metadata.sessionId, sbp("HYPOTENSIVE", 84));
      await manager.submitEvidence(
        session.metadata.sessionId,
        hr("SEVERE_TACHYCARDIA", 145)
      );

      await expect(
        manager.deferQuestion(session.metadata.sessionId, "ECG_ST_ELEVATION")
      ).rejects.toThrow("halted");
    });
  });

  describe("Session retrieval", () => {
    it("retrieves an existing session by ID", async () => {
      const created = await newSession();
      const retrieved = await manager.getSession(created.metadata.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.metadata.sessionId).toBe(created.metadata.sessionId);
    });

    it("returns null for non-existent session", async () => {
      const result = await manager.getSession("does-not-exist");
      expect(result).toBeNull();
    });
  });
});