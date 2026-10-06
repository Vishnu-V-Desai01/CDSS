// packages/api/src/__tests__/contract.test.ts
/**
 * Wire-contract tests for the fields the Active Session, HALT and Trace
 * screens read: minimumSafetySet, redFlagChecks, halt, lastMovement, trace.
 * Real compiled pack.json, in-memory store.
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

interface PackFeature {
  feature_id: string;
  dependency_group: string | null;
  states: Array<{ value: string; lr: number }>;
}
interface RawPack {
  conditions: Record<string, { features: PackFeature[] }>;
  red_flags: Record<string, { triggers: Array<{ finding_id: string }> }>;
}

const pack = JSON.parse(readFileSync(PACK_PATH, "utf8")) as RawPack;

const redFlagFindings = new Set(
  Object.values(pack.red_flags).flatMap((r) => r.triggers.map((t) => t.finding_id))
);

function commonStates(featureId: string): string[] {
  const sets = Object.values(pack.conditions)
    .map((c) => c.features.find((f) => f.feature_id === featureId))
    .filter((f): f is PackFeature => f !== undefined)
    .map((f) => new Set(f.states.map((s) => s.value)));
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return [...first!].filter((v) => rest.every((s) => s.has(v)));
}

/** A finding where CHF's LR is strictly the largest, so CHF's probability rises. */
function chfSupportiveFinding(): { featureId: string; state: string } | undefined {
  const chf = pack.conditions["CONGESTIVE_HEART_FAILURE"]!;
  let best: { featureId: string; state: string; lr: number } | undefined;

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
      if (s.lr > maxOther && (!best || s.lr > best.lr)) {
        best = { featureId: f.feature_id, state: s.value, lr: s.lr };
      }
    }
  }
  return best && { featureId: best.featureId, state: best.state };
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

async function newSession() {
  const res = await post("/session", {
    careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
    patientAge: 58,
    patientSex: "MALE",
    patientPregnancy: "NOT_APPLICABLE",
  });
  expect(res.status).toBe(201);
  return res.body as any;
}

function evidencePayload(
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
  return payload;
}

function submit(id: string, featureId: string, value: string, source: string, raw?: number | string) {
  return post(`/session/${id}/evidence`, evidencePayload(featureId, value, source, raw));
}

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

async function submitSafeVitals(id: string) {
  for (const [featureId, raw] of SAFE_VITALS) {
    const r = await submitVital(id, featureId, raw);
    expect(r.status).toBe(200);
  }
  const last = await submit(id, "EX_MENTAL_STATUS", "ALERT", "OBSERVED");
  expect(last.status).toBe(200);
  return last.body;
}

const sum = (entries: Array<{ probability: number }>) =>
  entries.reduce((a, e) => a + e.probability, 0);

const FIVE = [
  "ACUTE_PERICARDITIS",
  "CONGESTIVE_HEART_FAILURE",
  "PULMONARY_EMBOLISM",
  "UNKNOWN",
  "UNSTABLE_ANGINA",
];

// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.CDS_PERSIST = "0";
});

beforeEach(async () => {
  app = await buildApp({ packPath: PACK_PATH });
});

afterEach(async () => {
  await app.close();
});

describe("Wire contract: minimum safety set", () => {
  it("lists all seven vitals as missing at creation, then none once complete", async () => {
    const created = await newSession();
    expect(created.minimumSafetySet.complete).toBe(false);
    expect(created.minimumSafetySet.missing).toHaveLength(7);

    const body = await submitSafeVitals(created.metadata.sessionId);
    expect(body.minimumSafetySet).toEqual({ complete: true, missing: [] });
  });
});

describe("Wire contract: red-flag checks", () => {
  it("is populated from turn zero with wording for every missing finding", async () => {
    const created = await newSession();

    expect(created.redFlagChecks.length).toBeGreaterThan(0);
    for (const check of created.redFlagChecks) {
      expect(typeof check.ruleId).toBe("string");
      expect(check.displayName.length).toBeGreaterThan(0);
      expect(check.missingFindings.length).toBeGreaterThan(0);
      for (const f of check.missingFindings) {
        expect(f.prompt.length).toBeGreaterThan(0);
        expect(f.stateValues.length).toBeGreaterThan(0);
        expect(typeof f.answerable).toBe("boolean");
      }
    }
    expect(JSON.stringify(created)).not.toMatch(/SHADOW/);
  });

  it("once vitals are in, only directly answerable findings remain", async () => {
    const created = await newSession();
    const body = await submitSafeVitals(created.metadata.sessionId);

    const remaining = body.redFlagChecks.flatMap((c: any) => c.missingFindings);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((f: any) => f.answerable === true)).toBe(true);
    const ids = remaining.map((f: any) => f.featureId);
    expect(ids).not.toContain("SYSTOLIC_BLOOD_PRESSURE_CATEGORY");
    expect(ids).not.toContain("HEART_RATE_CATEGORY");
    expect(ids).not.toContain("OXYGEN_SATURATION_CATEGORY");
  });

  it("answering a red-flag finding removes it from the waiting list", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    const ready = await submitSafeVitals(id);

    const ids = ready.redFlagChecks.flatMap((c: any) =>
      c.missingFindings.map((f: any) => f.featureId)
    );
    expect(ids).toContain("SYNCOPE");

    const r = await submit(id, "SYNCOPE", "ABSENT", "PATIENT_REPORTED");
    expect(r.status).toBe(200);
    expect(r.body.halted).toBe(false);
    const after = r.body.redFlagChecks.flatMap((c: any) =>
      c.missingFindings.map((f: any) => f.featureId)
    );
    expect(after).not.toContain("SYNCOPE");
  });
});

describe("Wire contract: halt", () => {
  it("explains which rule fired, with no probabilities anywhere", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    await submitVital(id, "VS_SBP", 84);
    const r = await submitVital(id, "VS_HEART_RATE", 145);

    expect(r.body.halted).toBe(true);
    expect(r.body.halt.primaryRule).toBe("RF-01");
    const rule = r.body.halt.rules[0];
    expect(rule.displayName.length).toBeGreaterThan(0);
    expect(rule.haltMessage.length).toBeGreaterThan(0);
    expect(rule.triggers.length).toBeGreaterThan(0);
    expect(rule.triggers.some((t: any) => t.matched === true)).toBe(true);

    expect(r.body.distribution).toBeNull();
    expect(r.body.nextQuestion).toBeNull();
    expect(r.body.pending).toEqual([]);
    expect(r.body.lastMovement).toBeNull();
    expect(r.body.redFlagChecks).toEqual([]);
    expect(r.body.trace[r.body.trace.length - 1].kind).toBe("SESSION_HALTED");
    expect(JSON.stringify(r.body)).not.toMatch(/SHADOW/);
  });

  it("is cleared, and recorded as cleared, when the triggering value is corrected", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    const first = await submitVital(id, "VS_SBP", 84);
    const sbpId = first.body.evidenceLog[0].id as string;
    await submitVital(id, "VS_HEART_RATE", 145);

    const corrected = await post(
      `/session/${id}/evidence/${sbpId}`,
      evidencePayload("VS_SBP", "150", "MEASURED", 150)
    );

    expect(corrected.status).toBe(200);
    expect(corrected.body.halted).toBe(false);
    expect(corrected.body.halt).toBeNull();
    const kinds = corrected.body.trace.map((t: any) => t.kind);
    expect(kinds.slice(-2)).toEqual(["EVIDENCE_CORRECTED", "HALT_CLEARED"]);
  });
});

describe("Wire contract: trace", () => {
  it("records every submission, gap-free, and compares only once a differential exists", async () => {
    const created = await newSession();
    const body = await submitSafeVitals(created.metadata.sessionId);

    expect(body.trace).toHaveLength(7);
    expect(body.trace.map((t: any) => t.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(body.trace.every((t: any) => t.kind === "EVIDENCE_ADDED")).toBe(true);

    for (const rec of body.trace.slice(0, 6)) {
      expect(rec.before).toBeNull();
      expect(rec.after).toBeNull();
    }
    const completing = body.trace[6];
    expect(completing.before).toBeNull();
    expect(completing.after.map((e: any) => e.id).sort()).toEqual(FIVE);
    expect(body.lastMovement).toEqual(completing);
  });

  it("an answered finding moves belief, with before, after and citations", async () => {
    const finding = chfSupportiveFinding();
    expect(finding, "pack has no CHF-supportive finding").toBeDefined();

    const created = await newSession();
    const id = created.metadata.sessionId;
    await submitSafeVitals(id);
    const r = await submit(id, finding!.featureId, finding!.state, "OBSERVED");
    expect(r.status).toBe(200);

    const move = r.body.lastMovement;
    expect(move.kind).toBe("EVIDENCE_ADDED");
    expect(move.featureId).toBe(finding!.featureId);
    expect(move.before.map((e: any) => e.id).sort()).toEqual(FIVE);
    expect(move.after.map((e: any) => e.id).sort()).toEqual(FIVE);
    expect(sum(move.before)).toBeCloseTo(1, 8);
    expect(sum(move.after)).toBeCloseTo(1, 8);

    const chf = (rows: any[]) =>
      rows.find((e: any) => e.id === "CONGESTIVE_HEART_FAILURE").probability as number;
    expect(chf(move.after)).toBeGreaterThan(chf(move.before));

    expect(move.citations.length).toBeGreaterThan(0);
    for (const c of move.citations) {
      expect(FIVE).toContain(c.hypothesisId);
      expect(typeof c.citationId).toBe("string");
      expect(c.citationId.length).toBeGreaterThan(0);
    }
    // The movement's "after" is exactly the distribution being served.
    expect(move.after).toEqual(r.body.distribution.entries);
    expect(JSON.stringify(r.body)).not.toMatch(/SHADOW/);
  });

  it("a correction is a new record: earlier records are unchanged, before matches the old state", async () => {
    const finding = chfSupportiveFinding();
    expect(finding, "pack has no CHF-supportive finding").toBeDefined();
    const otherState = commonStates(finding!.featureId).find((s) => s !== finding!.state);
    expect(otherState, "feature has no second state").toBeDefined();

    const created = await newSession();
    const id = created.metadata.sessionId;
    await submitSafeVitals(id);
    const answered = await submit(id, finding!.featureId, finding!.state, "OBSERVED");
    const entryId = answered.body.evidenceLog.find(
      (e: any) => e.featureId === finding!.featureId
    ).id as string;
    const traceBefore = JSON.parse(JSON.stringify(answered.body.trace));

    const corrected = await post(
      `/session/${id}/evidence/${entryId}`,
      evidencePayload(finding!.featureId, otherState!, "OBSERVED")
    );
    expect(corrected.status).toBe(200);

    const trace = corrected.body.trace;
    expect(trace).toHaveLength(traceBefore.length + 1);
    expect(trace.slice(0, traceBefore.length)).toEqual(traceBefore);

    const rec = trace[trace.length - 1];
    expect(rec.kind).toBe("EVIDENCE_CORRECTED");
    expect(rec.corrects).toBe(entryId);
    expect(rec.previousValue).toBe(finding!.state);
    expect(rec.value).toBe(otherState);
    expect(rec.before).toEqual(answered.body.distribution.entries);
    expect(rec.after).toEqual(corrected.body.distribution.entries);
    expect(corrected.body.lastMovement.kind).toBe("EVIDENCE_CORRECTED");
  });

  it("deferral is recorded, and is not mistaken for a belief change", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    const ready = await submitSafeVitals(id);
    const featureId = ready.nextQuestion.featureId as string;

    const r = await post(`/session/${id}/defer`, { featureId });
    expect(r.status).toBe(200);

    const rec = r.body.trace[r.body.trace.length - 1];
    expect(rec.kind).toBe("QUESTION_DEFERRED");
    expect(rec.featureId).toBe(featureId);
    // lastMovement still points at the last evidence event.
    expect(r.body.lastMovement.kind).toBe("EVIDENCE_ADDED");
    expect(r.body.lastMovement.seq).toBe(6);
  });

  it("GET /trace serves the persisted trace", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    await submitSafeVitals(id);

    const { status, body } = await get(`/session/${id}/trace`);
    expect(status).toBe(200);
    expect(body.trace).toHaveLength(7);
    expect(body.distribution.entries).toHaveLength(5);
  });
});

describe("Wire contract: rejected input never poisons a session", () => {
  it("a 422 on submit leaves the log untouched and the session usable", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;

    const bad = await submit(id, "VS_HEART_RATE", "abc", "MEASURED", "abc");
    expect(bad.status).toBe(422);

    const fetched = await get(`/session/${id}`);
    expect(fetched.body.evidenceLog).toEqual([]);
    expect(fetched.body.trace).toEqual([]);

    const ok = await submitVital(id, "VS_HEART_RATE", 92);
    expect(ok.status).toBe(200);
    expect(ok.body.evidenceLog).toHaveLength(1);
  });

  it("a 422 on correction leaves the log untouched", async () => {
    const created = await newSession();
    const id = created.metadata.sessionId;
    const first = await submitVital(id, "VS_HEART_RATE", 92);
    const entryId = first.body.evidenceLog[0].id as string;

    const bad = await post(
      `/session/${id}/evidence/${entryId}`,
      evidencePayload("VS_HEART_RATE", "abc", "MEASURED", "abc")
    );
    expect(bad.status).toBe(422);

    const fetched = await get(`/session/${id}`);
    expect(fetched.body.evidenceLog).toHaveLength(1);
    expect(fetched.body.trace).toHaveLength(1);
  });
});