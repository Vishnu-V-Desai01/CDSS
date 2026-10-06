// packages/api/src/__tests__/answered.test.ts
/**
 * answeredEvidence, ranked distribution, and red-flag finding tiers: the
 * fields the Active Session screen reads. Real compiled pack.json.
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

const VITALS: Array<[string, number]> = [
  ["VS_HEART_RATE", 92],
  ["VS_RESP_RATE", 18],
  ["VS_SBP", 128],
  ["VS_DBP", 80],
  ["VS_SPO2_ROOM_AIR", 97],
  ["VS_TEMPERATURE", 36.8],
];

async function readySession() {
  const created = await post("/session", {
    careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
    patientAge: 58,
    patientSex: "MALE",
    patientPregnancy: "NOT_APPLICABLE",
  });
  const id = created.body.metadata.sessionId as string;
  for (const [f, raw] of VITALS) {
    const r = await post(`/session/${id}/evidence`, evidence(f, String(raw), "MEASURED", raw));
    expect(r.status).toBe(200);
  }
  const last = await post(`/session/${id}/evidence`, evidence("EX_MENTAL_STATUS", "ALERT", "OBSERVED"));
  expect(last.status).toBe(200);
  return { id, body: last.body as any };
}

function preferAbsent(states: string[]): string {
  return states.includes("ABSENT") ? "ABSENT" : states[0]!;
}

beforeAll(() => {
  process.env.CDS_PERSIST = "0";
});

beforeEach(async () => {
  app = await buildApp({ packPath: PACK_PATH });
});

afterEach(async () => {
  await app.close();
});

describe("answeredEvidence", () => {
  it("lists the seven vitals in the order recorded, with no pack wording", async () => {
    const { body } = await readySession();

    expect(body.answeredEvidence).toHaveLength(7);
    expect(body.answeredEvidence.every((e: any) => e.isVital === true)).toBe(true);
    expect(body.answeredEvidence.every((e: any) => e.prompt === null)).toBe(true);
    const turns = body.answeredEvidence.map((e: any) => e.turn);
    expect(turns).toEqual([...turns].sort((a: number, b: number) => a - b));

    const hr = body.answeredEvidence.find((e: any) => e.featureId === "VS_HEART_RATE");
    expect(hr.rawValue).toBe(92);
    const mental = body.answeredEvidence.find((e: any) => e.featureId === "EX_MENTAL_STATUS");
    expect(mental.rawValue).toBeNull();
    expect(mental.value).toBe("ALERT");
  });

  it("an answered question carries its wording, options and tier", async () => {
    const { id, body } = await readySession();
    const q = body.nextQuestion;
    const r = await post(
      `/session/${id}/evidence`,
      evidence(q.featureId, preferAbsent(q.stateValues), "OBSERVED")
    );
    expect(r.status).toBe(200);

    expect(r.body.answeredEvidence).toHaveLength(8);
    const item = r.body.answeredEvidence.find((e: any) => e.featureId === q.featureId);
    expect(item.isVital).toBe(false);
    expect(item.prompt).toBe(q.prompt);
    expect(item.stateValues).toEqual(q.stateValues);
    expect(item.tier).toBe(q.tier);
  });

  it("a correction replaces the entry rather than adding one", async () => {
    const { id, body } = await readySession();
    const q = body.nextQuestion;
    expect(q.stateValues.length).toBeGreaterThanOrEqual(2);
    const first = preferAbsent(q.stateValues);
    const second = q.stateValues.find((s: string) => s !== first) as string;

    const answered = await post(`/session/${id}/evidence`, evidence(q.featureId, first, "OBSERVED"));
    const oldItem = answered.body.answeredEvidence.find((e: any) => e.featureId === q.featureId);

    const corrected = await post(
      `/session/${id}/evidence/${oldItem.evidenceId}`,
      evidence(q.featureId, second, "OBSERVED")
    );
    expect(corrected.status).toBe(200);

    expect(corrected.body.answeredEvidence).toHaveLength(8);
    const newItem = corrected.body.answeredEvidence.find((e: any) => e.featureId === q.featureId);
    expect(newItem.value).toBe(second);
    expect(newItem.evidenceId).not.toBe(oldItem.evidenceId);
    // The retracted entry is still in the append-only log.
    expect(corrected.body.evidenceLog.some((e: any) => e.id === oldItem.evidenceId)).toBe(true);
  });

  it("correcting a vital updates its raw value", async () => {
    const { id, body } = await readySession();
    const sbp = body.answeredEvidence.find((e: any) => e.featureId === "VS_SBP");

    const corrected = await post(
      `/session/${id}/evidence/${sbp.evidenceId}`,
      evidence("VS_SBP", "135", "MEASURED", 135)
    );
    expect(corrected.status).toBe(200);

    expect(corrected.body.answeredEvidence).toHaveLength(7);
    const now = corrected.body.answeredEvidence.find((e: any) => e.featureId === "VS_SBP");
    expect(now.rawValue).toBe(135);
  });
});

describe("ranked distribution", () => {
  it("is served highest probability first", async () => {
    const { body } = await readySession();
    const p = body.distribution.entries.map((e: any) => e.probability as number);
    for (let i = 0; i < p.length - 1; i++) {
      expect(p[i]!).toBeGreaterThanOrEqual(p[i + 1]!);
    }
    expect(body.distribution.entries).toHaveLength(5);
  });
});

describe("red-flag findings", () => {
  it("carry the tier of their question, so the client can choose a source", async () => {
    const { body } = await readySession();
    const findings = body.redFlagChecks.flatMap((c: any) => c.missingFindings);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(typeof f.tier).toBe("string");
      expect(f.tier.length).toBeGreaterThan(0);
    }
  });
});