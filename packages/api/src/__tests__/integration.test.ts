// packages/api/src/__tests__/integration.test.ts
/**
 * Full path over HTTP against the REAL compiled pack.json, in-memory store.
 * Evidence for the reasoning tests is chosen from the pack at run time, so
 * these tests do not hardcode clinical content that could change.
 *
 * Build the pack first:  npm run pack:build
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");

// ---------------------------------------------------------------------------
// Pack access (read-only, for choosing valid evidence)
// ---------------------------------------------------------------------------

interface PackState {
  value: string;
  lr: number;
}
interface PackFeature {
  feature_id: string;
  dependency_group: string | null;
  states: PackState[];
}
interface PackCondition {
  condition_id: string;
  features: PackFeature[];
}
interface RawPack {
  conditions: Record<string, PackCondition>;
  red_flags: Record<string, { triggers: Array<{ finding_id: string }> }>;
}

const pack = JSON.parse(readFileSync(PACK_PATH, "utf8")) as RawPack;

const redFlagFindings = new Set(
  Object.values(pack.red_flags).flatMap((r) => r.triggers.map((t) => t.finding_id))
);

/** States that EVERY condition declaring this feature has an LR for. */
function commonStates(featureId: string): string[] {
  const sets = Object.values(pack.conditions)
    .map((c) => c.features.find((f) => f.feature_id === featureId))
    .filter((f): f is PackFeature => f !== undefined)
    .map((f) => new Set(f.states.map((s) => s.value)));
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return [...first!].filter((v) => rest.every((s) => s.has(v)));
}

interface Finding {
  featureId: string;
  state: string;
}

/**
 * Findings where CONGESTIVE_HEART_FAILURE's LR is strictly the largest of any
 * condition for that state, so answering them must raise CHF's probability.
 * Red-flag findings are excluded so the session cannot halt by accident.
 */
function chfSupportiveFindings(max: number): Finding[] {
  const chf = pack.conditions["CONGESTIVE_HEART_FAILURE"]!;
  const found: Array<Finding & { lr: number; group: string | null }> = [];

  for (const f of chf.features) {
    if (redFlagFindings.has(f.feature_id)) continue;
    const allowed = new Set(commonStates(f.feature_id));
    for (const s of f.states) {
      if (s.lr <= 1 || !allowed.has(s.value)) continue;
      let maxOther = 1;
      for (const [id, c] of Object.entries(pack.conditions)) {
        if (id === "CONGESTIVE_HEART_FAILURE") continue;
        const other = c.features
          .find((x) => x.feature_id === f.feature_id)
          ?.states.find((x) => x.value === s.value);
        if (other && other.lr > maxOther) maxOther = other.lr;
      }
      if (s.lr > maxOther) {
        found.push({ featureId: f.feature_id, state: s.value, lr: s.lr, group: f.dependency_group });
      }
    }
  }

  found.sort((a, b) => b.lr - a.lr);
  const picked: Finding[] = [];
  const usedGroups = new Set<string>();
  const usedFeatures = new Set<string>();
  for (const f of found) {
    if (usedFeatures.has(f.featureId)) continue;
    if (f.group !== null && usedGroups.has(f.group)) continue;
    picked.push({ featureId: f.featureId, state: f.state });
    usedFeatures.add(f.featureId);
    if (f.group !== null) usedGroups.add(f.group);
    if (picked.length === max) break;
  }
  return picked;
}

/** Any n answerable, non-red-flag findings, deterministic order. */
function anyFindings(n: number): Finding[] {
  const ids = new Set<string>();
  for (const c of Object.values(pack.conditions)) {
    for (const f of c.features) ids.add(f.feature_id);
  }
  const out: Finding[] = [];
  for (const id of [...ids].sort()) {
    if (redFlagFindings.has(id)) continue;
    const states = commonStates(id);
    if (states.length === 0) continue;
    out.push({ featureId: id, state: states[0]! });
    if (out.length === n) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

let app: FastifyInstance;

const nowIso = () => new Date().toISOString();

async function post(url: string, payload: object) {
  const res = await app.inject({ method: "POST", url, payload });
  return { status: res.statusCode, body: JSON.parse(res.payload) as any };
}

async function get(url: string) {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: JSON.parse(res.payload) as any };
}

async function newSession(overrides: Record<string, unknown> = {}) {
  const res = await post("/session", {
    careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
    patientAge: 58,
    patientSex: "MALE",
    patientPregnancy: "NOT_APPLICABLE",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.metadata.sessionId as string;
}

async function submit(
  id: string,
  featureId: string,
  value: string,
  source: string,
  rawValue?: number | string
) {
  const payload: Record<string, unknown> = {
    featureId,
    value,
    source,
    observedAt: nowIso(),
    observerConfidence: "HIGH",
  };
  if (rawValue !== undefined) payload.rawValue = rawValue;
  return post(`/session/${id}/evidence`, payload);
}

/** A numeric vital: the client sends the raw number, the server bins it. */
function submitVital(id: string, featureId: string, raw: number) {
  return submit(id, featureId, String(raw), "MEASURED", raw);
}

const SAFE_VITALS: Array<[string, number]> = [
  ["VS_HEART_RATE", 92],
  ["VS_RESP_RATE", 18],
  ["VS_SBP", 128],
  ["VS_DBP", 80],
  ["VS_SPO2_ROOM_AIR", 97],
  ["VS_TEMPERATURE", 36.8],
];

/** All seven minimum-safety-set observations, none abnormal. */
async function submitSafeVitals(id: string) {
  for (const [featureId, raw] of SAFE_VITALS) {
    const r = await submitVital(id, featureId, raw);
    expect(r.status).toBe(200);
  }
  const last = await submit(id, "EX_MENTAL_STATUS", "ALERT", "OBSERVED");
  expect(last.status).toBe(200);
  return last.body;
}

function probabilityOf(body: any, id: string): number {
  const entry = body.distribution.entries.find((e: any) => e.id === id);
  expect(entry).toBeDefined();
  return entry.probability as number;
}

// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.CDS_PERSIST = "0"; // in-memory store, nothing written to disk
});

beforeEach(async () => {
  app = await buildApp({ packPath: PACK_PATH });
});

afterEach(async () => {
  await app.close();
});

describe("Integration: full path over HTTP", () => {
  describe("GET /health", () => {
    it("reports ok, the pack hash, and the supported care settings", async () => {
      const { status, body } = await get("/health");
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.knowledgePackHash).toMatch(/^sha256:/);
      expect(Array.isArray(body.supportedCareSettings)).toBe(true);
      expect(body.supportedCareSettings).toContain("ED_UNDIFFERENTIATED_CHEST_PAIN");
    });
  });

  describe("GET /sources", () => {
    it("responds with an object", async () => {
      const { status, body } = await get("/sources");
      expect(status).toBe(200);
      expect(typeof body).toBe("object");
    });
  });

  describe("Session creation", () => {
    it("creates a session with no differential yet", async () => {
      const res = await post("/session", {
        careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
        patientAge: 58,
        patientSex: "MALE",
        patientPregnancy: "NOT_APPLICABLE",
      });
      expect(res.status).toBe(201);
      expect(res.body.metadata.sessionId).toBeTruthy();
      expect(res.body.metadata.careSetting).toBe("ED_UNDIFFERENTIATED_CHEST_PAIN");
      expect(res.body.halted).toBe(false);
      expect(res.body.turn).toBe(0);
      expect(res.body.evidenceLog).toEqual([]);
      expect(res.body.distribution).toBeNull();
      expect(res.body.nextQuestion).toBeNull();
      expect(res.body.deferredFeatureIds).toEqual([]);
    });

    it("rejects an invalid body with 400", async () => {
      const res = await post("/session", {
        careSetting: "NOT_A_SETTING",
        patientAge: 58,
        patientSex: "MALE",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Red flag halt — RF-01 (Haemodynamic Collapse), full path", () => {
    it("does not halt on a single trigger", async () => {
      const id = await newSession();
      const r = await submitVital(id, "VS_SBP", 84);
      expect(r.status).toBe(200);
      expect(r.body.halted).toBe(false);
    });

    it("halts when both triggers are present, and the response carries no differential", async () => {
      const id = await newSession();
      await submitVital(id, "VS_SBP", 84);
      const r = await submitVital(id, "VS_HEART_RATE", 145);

      expect(r.status).toBe(200);
      expect(r.body.halted).toBe(true);
      expect(r.body.haltRule).toBe("RF-01");
      // Absent by construction, not hidden: nothing to render on the HALT screen.
      expect(r.body.distribution).toBeNull();
      expect(r.body.nextQuestion).toBeNull();
      expect(r.body.pending).toEqual([]);
      expect(JSON.stringify(r.body)).not.toMatch(/SHADOW/);
    });

    it("locks the session — further evidence returns 423, engine never runs", async () => {
      const id = await newSession();
      await submitVital(id, "VS_SBP", 84);
      await submitVital(id, "VS_HEART_RATE", 145);

      const r = await submit(id, "ORTHOPNEA", "ABSENT", "PATIENT_REPORTED");
      expect(r.status).toBe(423);
    });

    it("halted session's trace shows the halt rule and no differential", async () => {
      const id = await newSession();
      await submitVital(id, "VS_SBP", 84);
      await submitVital(id, "VS_HEART_RATE", 145);

      const { status, body } = await get(`/session/${id}/trace`);
      expect(status).toBe(200);
      expect(body.halted).toBe(true);
      expect(body.haltRule).toBe("RF-01");
      expect(body.distribution).toBeNull();
      expect(body.evidenceLog).toHaveLength(2);
    });
  });

  describe("Evidence correction — retract and replay", () => {
    it("correcting the triggering value lifts the halt, and the original is retained", async () => {
      const id = await newSession();
      const first = await submitVital(id, "VS_SBP", 84);
      const sbpEntryId = first.body.evidenceLog[0].id as string;
      const halted = await submitVital(id, "VS_HEART_RATE", 145);
      expect(halted.body.halted).toBe(true);

      const corrected = await post(`/session/${id}/evidence/${sbpEntryId}`, {
        featureId: "VS_SBP",
        value: "150",
        rawValue: 150,
        source: "MEASURED",
        observedAt: nowIso(),
        observerConfidence: "HIGH",
      });

      expect(corrected.status).toBe(200);
      expect(corrected.body.halted).toBe(false);
      expect(corrected.body.haltRule).toBeNull();
      // Append-only: the original entry is still there, and the correction points at it.
      expect(corrected.body.evidenceLog).toHaveLength(3);
      expect(corrected.body.evidenceLog[0].id).toBe(sbpEntryId);
      expect(
        corrected.body.evidenceLog.some((e: any) => e.corrects === sbpEntryId)
      ).toBe(true);
    });

    it("correcting an answer updates the distribution", async () => {
      const [finding] = chfSupportiveFindings(1);
      expect(finding, "pack has no CHF-supportive finding to correct").toBeDefined();

      const id = await newSession();
      await submitSafeVitals(id);
      const answered = await submit(id, finding!.featureId, finding!.state, "OBSERVED");
      expect(answered.status).toBe(200);
      const before = probabilityOf(answered.body, "CONGESTIVE_HEART_FAILURE");

      const otherState = commonStates(finding!.featureId).find((s) => s !== finding!.state);
      expect(otherState, "feature has no second state").toBeDefined();
      const entryId = answered.body.evidenceLog.find(
        (e: any) => e.featureId === finding!.featureId
      ).id as string;

      const corrected = await post(`/session/${id}/evidence/${entryId}`, {
        featureId: finding!.featureId,
        value: otherState,
        source: "OBSERVED",
        observedAt: nowIso(),
        observerConfidence: "HIGH",
      });

      expect(corrected.status).toBe(200);
      const after = probabilityOf(corrected.body, "CONGESTIVE_HEART_FAILURE");
      expect(after).not.toBeCloseTo(before, 6);
      // The retracted answer is still in the evidence log.
      expect(corrected.body.evidenceLog.some((e: any) => e.id === entryId)).toBe(true);
    });
  });

  describe("Minimum safety set — differential withheld until vitals complete", () => {
    it("produces no differential until all minimum safety observations are present", async () => {
      const id = await newSession();
      const r = await submitVital(id, "VS_HEART_RATE", 92);
      expect(r.body.halted).toBe(false);
      expect(r.body.distribution).toBeNull(); // one of seven required vitals present
      expect(r.body.nextQuestion).toBeNull();
    });

    it("produces the five-entry differential once all seven observations are present", async () => {
      const id = await newSession();
      const body = await submitSafeVitals(id);

      expect(body.halted).toBe(false);
      expect(body.distribution).not.toBeNull();
      expect(body.distribution.entries.map((e: any) => e.id).sort()).toEqual([
        "ACUTE_PERICARDITIS",
        "CONGESTIVE_HEART_FAILURE",
        "PULMONARY_EMBOLISM",
        "UNKNOWN",
        "UNSTABLE_ANGINA",
      ]);
      const total = body.distribution.entries.reduce(
        (a: number, e: any) => a + e.probability,
        0
      );
      expect(total).toBeCloseTo(1, 8);
      // Shadow conditions must not appear anywhere on the wire.
      expect(JSON.stringify(body)).not.toMatch(/SHADOW/);
    });

    it("serves a renderable next question", async () => {
      const id = await newSession();
      const body = await submitSafeVitals(id);

      expect(body.nextQuestion).not.toBeNull();
      const q = body.nextQuestion;
      expect(typeof q.featureId).toBe("string");
      expect(typeof q.prompt).toBe("string");
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(Array.isArray(q.stateValues)).toBe(true);
      expect(q.stateValues.length).toBeGreaterThan(0);
      expect(q.cost).toBeGreaterThan(0);
      expect(q.eigBits).toBeGreaterThanOrEqual(0);
    });

    it("rejects a care setting the pack has no priors for, at intake", async () => {
      const { body: health } = await get("/health");
      const supported: string[] = health.supportedCareSettings;
      expect(supported).toContain("ED_UNDIFFERENTIATED_CHEST_PAIN");

      const all = [
        "ED_UNDIFFERENTIATED_CHEST_PAIN",
        "PRIMARY_CARE_CHEST_PAIN",
        "PREHOSPITAL",
        "TELEHEALTH_TRIAGE",
      ];
      for (const cs of all) {
        const res = await post("/session", {
          careSetting: cs,
          patientAge: 58,
          patientSex: "MALE",
          patientPregnancy: "NOT_APPLICABLE",
        });
        expect(res.status, cs).toBe(supported.includes(cs) ? 201 : 422);
        if (!supported.includes(cs)) {
          expect(res.body.error).toMatch(/not supported/);
        }
      }
    });

    it("uses the care setting chosen at intake, when the pack supports more than one", async () => {
      const { body: health } = await get("/health");
      const supported: string[] = health.supportedCareSettings;
      if (supported.length < 2) return; // nothing to compare until the pack has more priors

      const a = await newSession({ careSetting: supported[0] });
      const b = await newSession({ careSetting: supported[1] });
      const probsA = (await submitSafeVitals(a)).distribution.entries.map((e: any) => e.probability);
      const probsB = (await submitSafeVitals(b)).distribution.entries.map((e: any) => e.probability);
      expect(probsA).not.toEqual(probsB);
    });
  });

  describe("Engine reasoning — real CHF-supportive evidence", () => {
    it("raises CHF's probability when CHF-supportive findings are submitted", async () => {
      const findings = chfSupportiveFindings(2);
      expect(findings.length, "pack has no CHF-supportive findings").toBeGreaterThan(0);

      const id = await newSession();
      const baseline = await submitSafeVitals(id);
      const before = probabilityOf(baseline, "CONGESTIVE_HEART_FAILURE");

      let last = baseline;
      for (const f of findings) {
        const r = await submit(id, f.featureId, f.state, "OBSERVED");
        expect(r.status).toBe(200);
        expect(r.body.halted).toBe(false);
        last = r.body;
      }

      expect(probabilityOf(last, "CONGESTIVE_HEART_FAILURE")).toBeGreaterThan(before);
    });
  });

  describe("Order independence over HTTP", () => {
    it("same evidence submitted in different sequences yields identical final probabilities", async () => {
      const findings = anyFindings(2);
      expect(findings).toHaveLength(2);
      const [x, y] = findings as [Finding, Finding];

      const idA = await newSession();
      await submitSafeVitals(idA);
      await submit(idA, x.featureId, x.state, "OBSERVED");
      const a = await submit(idA, y.featureId, y.state, "OBSERVED");

      const idB = await newSession();
      await submitSafeVitals(idB);
      await submit(idB, y.featureId, y.state, "OBSERVED");
      const b = await submit(idB, x.featureId, x.state, "OBSERVED");

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const sort = (body: any) =>
        [...body.distribution.entries].sort((p: any, q: any) => p.id.localeCompare(q.id));
      const sortedA = sort(a.body);
      const sortedB = sort(b.body);

      expect(sortedA.map((e: any) => e.id)).toEqual(sortedB.map((e: any) => e.id));
      sortedA.forEach((e: any, i: number) => {
        expect(e.probability).toBeCloseTo(sortedB[i].probability, 10);
      });
    });
  });

  describe("Deferral over HTTP", () => {
    it("defers a question without halting or erroring", async () => {
      const id = await newSession();
      const res = await post(`/session/${id}/defer`, { featureId: "ECG_ST_ELEVATION" });

      expect(res.status).toBe(200);
      expect(res.body.halted).toBe(false);
      expect(res.body.deferredFeatureIds).toContainEqual(
        expect.objectContaining({ featureId: "ECG_ST_ELEVATION" })
      );
      // Safety set not met, so deferral does not conjure a differential.
      expect(res.body.distribution).toBeNull();
    });

    it("keeps a deferred question visible with its impact score", async () => {
      const id = await newSession();
      const ready = await submitSafeVitals(id);
      const featureId = ready.nextQuestion.featureId as string;

      const res = await post(`/session/${id}/defer`, { featureId });
      expect(res.status).toBe(200);

      const item = res.body.pending.find((p: any) => p.featureId === featureId);
      expect(item).toBeDefined();
      expect(typeof item.impactAtDeferral).toBe("number");
      expect(item.prompt.length).toBeGreaterThan(0);
      expect(item.stateValues.length).toBeGreaterThan(0);
      expect(res.body.nextQuestion?.featureId).not.toBe(featureId);
    });

    it("423s deferral on a halted session", async () => {
      const id = await newSession();
      await submitVital(id, "VS_SBP", 84);
      await submitVital(id, "VS_HEART_RATE", 145);

      const res = await post(`/session/${id}/defer`, { featureId: "ECG_ST_ELEVATION" });
      expect(res.status).toBe(423);
    });
  });

  describe("Canonicalisation failure — 422, gate never reached", () => {
    it("rejects a non-numeric vital with 422", async () => {
      const id = await newSession();
      const r = await submit(id, "VS_HEART_RATE", "abc", "MEASURED", "abc");
      expect(r.status).toBe(422);
      expect(r.body.error).toMatch(/Canonicalisation failed/);
    });
  });

  describe("404 handling", () => {
    it("404s GET on an unknown session", async () => {
      const r = await get("/session/does-not-exist");
      expect(r.status).toBe(404);
    });

    it("404s evidence on an unknown session", async () => {
      const r = await submit("does-not-exist", "ORTHOPNEA", "ABSENT", "PATIENT_REPORTED");
      expect(r.status).toBe(404);
    });
  });
});