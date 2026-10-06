// packages/api/src/__tests__/question-wording.test.ts
/**
 * The ranker may only offer questions that a reportable condition declares,
 * and no wording served to the client may name a hidden condition.
 * Real compiled pack.json.   Build first: npm run pack:build
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { CANDIDATE_IDS } from "@cds/shared-types";
import { buildApp } from "../app.js";
import { loadPack, type LoadedPack } from "../packLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");

const HIDDEN_WORDING = /anxiety|panic|musculoskeletal|reflux|gord|shadow/i;

let pack: LoadedPack;
let app: FastifyInstance;

const inScope = new Set<string>(CANDIDATE_IDS);

function shadowOnlyFeatures(): string[] {
  const scoped = new Set<string>();
  const hidden = new Set<string>();
  for (const c of Object.values(pack.conditions)) {
    const target = inScope.has(c.condition_id) ? scoped : hidden;
    for (const f of c.features) target.add(f.feature_id);
  }
  return [...hidden].filter((id) => !scoped.has(id)).sort();
}

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

beforeAll(async () => {
  process.env.CDS_PERSIST = "0";
  pack = await loadPack(PACK_PATH);
});

beforeEach(async () => {
  app = await buildApp({ packPath: PACK_PATH });
});

afterEach(async () => {
  await app.close();
});

describe("question scope", () => {
  it("the pack has features only hidden conditions declare, so this is not vacuous", () => {
    expect(shadowOnlyFeatures().length).toBeGreaterThan(0);
  });

  it("the ranker never offers those features, and no served wording names a hidden condition", async () => {
    const hiddenOnly = new Set(shadowOnlyFeatures());

    const created = await post("/session", {
      careSetting: "ED_UNDIFFERENTIATED_CHEST_PAIN",
      patientAge: 58,
      patientSex: "MALE",
      patientPregnancy: "NOT_APPLICABLE",
    });
    const id = created.body.metadata.sessionId as string;

    const vitals: Array<[string, number]> = [
      ["VS_HEART_RATE", 92],
      ["VS_RESP_RATE", 18],
      ["VS_SBP", 128],
      ["VS_DBP", 80],
      ["VS_SPO2_ROOM_AIR", 97],
      ["VS_TEMPERATURE", 36.8],
    ];
    for (const [f, raw] of vitals) {
      const r = await post(`/session/${id}/evidence`, evidence(f, String(raw), "MEASURED", raw));
      expect(r.status).toBe(200);
    }
    let r = await post(`/session/${id}/evidence`, evidence("EX_MENTAL_STATUS", "ALERT", "OBSERVED"));
    expect(r.status).toBe(200);
    let body = r.body;

    const served: string[] = [];
    for (let i = 0; i < 80 && body.nextQuestion && !body.halted; i++) {
      const q = body.nextQuestion;
      served.push(q.featureId as string);

      expect(hiddenOnly.has(q.featureId), `ranker offered ${q.featureId}`).toBe(false);
      expect(q.prompt, q.featureId).not.toMatch(HIDDEN_WORDING);
      for (const s of q.stateValues as string[]) expect(s).not.toMatch(HIDDEN_WORDING);

      // Prefer ABSENT so answering cannot fire a red-flag rule and end the walk.
      const state = (q.stateValues as string[]).includes("ABSENT")
        ? "ABSENT"
        : (q.stateValues as string[])[0]!;
      r = await post(
        `/session/${id}/evidence`,
        evidence(q.featureId, state, q.tier === "HISTORY" ? "PATIENT_REPORTED" : "OBSERVED")
      );
      expect(r.status, q.featureId).toBe(200);
      body = r.body;
    }

    expect(served.length).toBeGreaterThan(0);
    // Everything else the client can see: pending, red-flag checks, trace.
    expect(JSON.stringify(body)).not.toMatch(HIDDEN_WORDING);
  });
});