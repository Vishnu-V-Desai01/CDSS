// packages/session-store/src/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store.js";
import type { SessionMetadata } from "../types.js";

describe("MemoryStore", () => {
  let store: MemoryStore;
  let metadata: SessionMetadata;

  beforeEach(() => {
    store = new MemoryStore();
    metadata = {
      sessionId: "test-session",
      createdAt: new Date().toISOString(),
      careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
      patientAge: 45,
      patientSex: "MALE",
    };
  });

  it("creates and retrieves a session", async () => {
    const created = await store.create(metadata);
    const retrieved = await store.get(metadata.sessionId);

    expect(retrieved).toBeDefined();
    expect(retrieved!.metadata.sessionId).toBe(metadata.sessionId);
    expect(retrieved!.metadata.patientAge).toBe(45);
  });

  it("appends evidence without mutation", async () => {
    const session = await store.create(metadata);

    const entry1 = {
      id: "1",
      featureId: "VS_HR",
      value: "NORMAL",
      source: "MEASURED" as const,
      observedAt: new Date().toISOString(),
      observerConfidence: "HIGH" as const,
      turn: 1,
    };

    await store.addEvidence(metadata.sessionId, entry1);
    let retrieved = await store.get(metadata.sessionId);
    expect(retrieved!.evidenceLog).toHaveLength(1);

    const entry2 = {
      id: "2",
      featureId: "VS_SBP",
      value: "NORMAL",
      source: "MEASURED" as const,
      observedAt: new Date().toISOString(),
      observerConfidence: "HIGH" as const,
      turn: 2,
    };

    await store.addEvidence(metadata.sessionId, entry2);
    retrieved = await store.get(metadata.sessionId);
    expect(retrieved!.evidenceLog).toHaveLength(2);
    expect(retrieved!.evidenceLog[0].id).toBe("1");
    expect(retrieved!.evidenceLog[1].id).toBe("2");
  });

  it("records halt without allowing new evidence", async () => {
    const session = await store.create(metadata);

    await store.recordHalt(metadata.sessionId, "RF-01 fired", "RF-01");
    const retrieved = await store.get(metadata.sessionId);

    expect(retrieved!.halted).toBe(true);
    expect(retrieved!.haltReason).toBe("RF-01 fired");
    expect(retrieved!.haltRule).toBe("RF-01");
  });

  it("lists all sessions", async () => {
    const meta1: SessionMetadata = { ...metadata, sessionId: "session-1" };
    const meta2: SessionMetadata = { ...metadata, sessionId: "session-2" };
    const meta3: SessionMetadata = { ...metadata, sessionId: "session-3" };

    await store.create(meta1);
    await store.create(meta2);
    await store.create(meta3);

    const list = await store.listSessions();

    expect(list).toContain("session-1");
    expect(list).toContain("session-2");
    expect(list).toContain("session-3");
  });

  it("deletes a session", async () => {
    await store.create(metadata);
    let retrieved = await store.get(metadata.sessionId);
    expect(retrieved).toBeDefined();

    await store.delete(metadata.sessionId);
    retrieved = await store.get(metadata.sessionId);
    expect(retrieved).toBeNull();
  });

  it("maintains separate sessions with different IDs", async () => {
    const meta1: SessionMetadata = { ...metadata, sessionId: "session-alpha" };
    const meta2: SessionMetadata = { ...metadata, sessionId: "session-beta" };

    await store.create(meta1);
    await store.create(meta2);

    const retrieved1 = await store.get("session-alpha");
    const retrieved2 = await store.get("session-beta");

    expect(retrieved1!.metadata.sessionId).toBe("session-alpha");
    expect(retrieved2!.metadata.sessionId).toBe("session-beta");
  });

  it("evidence log is truly append-only", async () => {
    await store.create(metadata);

    const entries = [
      {
        id: "entry-1",
        featureId: "VS_HR",
        value: "NORMAL",
        source: "MEASURED" as const,
        observedAt: new Date().toISOString(),
        observerConfidence: "HIGH" as const,
        turn: 1,
      },
      {
        id: "entry-2",
        featureId: "VS_SBP",
        value: "NORMAL",
        source: "MEASURED" as const,
        observedAt: new Date().toISOString(),
        observerConfidence: "HIGH" as const,
        turn: 2,
      },
      {
        id: "entry-3",
        featureId: "ORTHOPNEA",
        value: "ABSENT",
        source: "PATIENT_REPORTED" as const,
        observedAt: new Date().toISOString(),
        observerConfidence: "MEDIUM" as const,
        turn: 3,
      },
    ];

    for (const entry of entries) {
      await store.addEvidence(metadata.sessionId, entry);
    }

    const retrieved = await store.get(metadata.sessionId);
    expect(retrieved!.evidenceLog).toHaveLength(3);
    expect(retrieved!.evidenceLog.map((e) => e.id)).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
    ]);
  });
});