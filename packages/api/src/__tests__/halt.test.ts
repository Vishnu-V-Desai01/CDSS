// packages/api/src/__tests__/halt.test.ts
/**
 * Halt details the HALT screen reads: which recorded readings caused each
 * trigger, so the clinician can correct the right one. Real compiled pack.
 * Build first: npm run pack:build
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");

let app: FastifyInstance;

const nowIso = () => new Date().toISOString();

async function post(url: string, payload: object) {
  const res = await app.inject({ method: "POST", url, payload });
  return { status: res.statusCode, body: JSON.parse(res.payload) as any };
}

function evidence(featureId: string, value: string, source: string, rawValue?: number) {
  const p: Record<string, unknown> = {
    featureId,
    value,
    source,
    observedAt: nowIso(),
    observerConfidence: "HIGH",
  };
  if (rawValue !== undefined) p.rawValue = rawValue;
  return p;
}

async function newSession(): Promise<string> {
  const res = await post("/session", {
    careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
    patientAge: 60,
    patientSex: "MALE",
    patientPregnancy: "NOT_APPLICABLE",
  });
  expect(res.status).toBe(201);
  return res.body.metadata.sessionId as string;
}

function vital(id: string, featureId: string, raw: number) {
  return post(`/session/${id}/evidence`, evidence(featureId, String(raw), "MEASURED", raw));
}

/** Every source a halt names must be a current entry the client can correct. */
function expectSourcesResolve(body: any) {
  const answered = new Map<string, string>(
    body.answeredEvidence.map((a: any) => [a.evidenceId as string, a.featureId as string])
  );
  for (const rule of body.halt.rules) {
    for (const t of rule.triggers) {
      for (const s of t.sourceEvidence) {
        expect(answered.get(s.evidenceId), `${t.findingId} -> ${s.evidenceId}`).toBe(s.featureId);
      }
    }
  }
}

const trigger = (body: any, findingId: string) =>
  body.halt.rules[0].triggers.find((t: any) => t.findingId === findingId);

beforeAll(() => {
  process.env.CDS_PERSIST = "0";
});
beforeEach(async () => {
  app = await buildApp({ packPath: PACK_PATH });
});
afterEach(async () => {
  await app.close();
});

describe("halt source readings", () => {
  it("names the readings behind each derived trigger", async () => {
    const id = await newSession();
    await vital(id, "VS_HEART_RATE", 145);
    const sbp = await vital(id, "VS_SBP", 84);

    expect(sbp.body.halted).toBe(true);
    expect(sbp.body.halt.primaryRule).toBe("RF-01");
    expectSourcesResolve(sbp.body);

    const hr = trigger(sbp.body, "HEART_RATE_CATEGORY");
    expect(hr.sourceEvidence.map((s: any) => s.featureId)).toEqual(["VS_HEART_RATE"]);
    const bp = trigger(sbp.body, "SYSTOLIC_BLOOD_PRESSURE_CATEGORY");
    expect(bp.sourceEvidence.map((s: any) => s.featureId)).toEqual(["VS_SBP"]);
  });

  it("includes diastolic when mean arterial pressure can be the cause", async () => {
    const id = await newSession();
    await vital(id, "VS_HEART_RATE", 145);
    await vital(id, "VS_DBP", 40);
    // 95/40: systolic alone is not low, but MAP = (95 + 2*40) / 3 = 58.
    const r = await vital(id, "VS_SBP", 95);

    expect(r.body.halted).toBe(true);
    expectSourcesResolve(r.body);
    const bp = trigger(r.body, "SYSTOLIC_BLOOD_PRESSURE_CATEGORY");
    expect(bp.observedState).toBe("HYPOTENSIVE");
    expect(bp.sourceEvidence.map((s: any) => s.featureId).sort()).toEqual(["VS_DBP", "VS_SBP"]);
  });

  it("a directly answered finding is its own source", async () => {
    const id = await newSession();
    const r = await post(`/session/${id}/evidence`, evidence("ECG_ST_ELEVATION", "PRESENT", "OBSERVED"));

    expect(r.body.halted).toBe(true);
    expect(r.body.halt.primaryRule).toBe("RF-03");
    expectSourcesResolve(r.body);
    expect(r.body.halt.rules[0].triggers[0].sourceEvidence).toEqual([
      { evidenceId: r.body.evidenceLog[0].id, featureId: "ECG_ST_ELEVATION" },
    ]);
  });

  it("after a correction that still halts, sources point at the new entry", async () => {
    const id = await newSession();
    await vital(id, "VS_HEART_RATE", 145);
    const first = await vital(id, "VS_SBP", 84);
    const oldId = trigger(first.body, "SYSTOLIC_BLOOD_PRESSURE_CATEGORY").sourceEvidence[0].evidenceId;

    const fixed = await post(`/session/${id}/evidence/${oldId}`, evidence("VS_SBP", "80", "MEASURED", 80));
    expect(fixed.status).toBe(200);
    expect(fixed.body.halted).toBe(true);
    expectSourcesResolve(fixed.body);

    const newId = fixed.body.evidenceLog.find((e: any) => e.corrects === oldId).id;
    const bp = trigger(fixed.body, "SYSTOLIC_BLOOD_PRESSURE_CATEGORY");
    expect(bp.sourceEvidence[0].evidenceId).toBe(newId);
    expect(bp.sourceEvidence[0].evidenceId).not.toBe(oldId);
  });
});