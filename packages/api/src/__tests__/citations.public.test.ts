// packages/api/src/__tests__/citations.public.test.ts
/**
 * Citations that support only the UNKNOWN aggregate must never reach the
 * client by id, title or notes, and every citation the trace emits must be
 * resolvable in /sources (the two-click rule).
 * Real compiled pack.json.   Build first: npm run pack:build
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadPack, type LoadedPack } from "../packLoader.js";
import { buildSourcesResponse } from "../sources.js";
import { buildPublicCitationMap, UNKNOWN_BASIS_ID } from "../publicCitations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");

let pack: LoadedPack;
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

describe("withheld citations", () => {
  it("the pack has citations that support only UNKNOWN, so this is not vacuous", () => {
    expect(buildPublicCitationMap(pack).withheldIds.size).toBeGreaterThan(0);
  });

  it("/sources replaces them with one neutral UNKNOWN_BASIS entry", () => {
    const sources = buildSourcesResponse(pack);
    const map = buildPublicCitationMap(pack);
    const ids = sources.citations.map((c) => c.id);
    const json = JSON.stringify(sources);

    expect(ids.filter((id) => id === UNKNOWN_BASIS_ID)).toHaveLength(1);
    for (const withheld of map.withheldIds) {
      expect(ids, withheld).not.toContain(withheld);
      expect(json, withheld).not.toContain(withheld);
    }
    expect(json).not.toMatch(/shadow/i);

    const basis = sources.citations.find((c) => c.id === UNKNOWN_BASIS_ID)!;
    expect(basis.usedInUnknownAggregate).toBe(true);
    expect(basis.usedBy).toEqual([]);
    expect(["A", "B", "C", "D"]).toContain(basis.evidenceGrade);
  });
});

describe("trace citations resolve in /sources", () => {
  it("every citation id the trace emits is in the index, with no hidden names anywhere", async () => {
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

    // Let the engine's own ranker choose what to ask, so the answers touch
    // whichever findings it considers most informative.
    for (let i = 0; i < 8 && body.nextQuestion && !body.halted; i++) {
      const q = body.nextQuestion;
      r = await post(
        `/session/${id}/evidence`,
        evidence(q.featureId, q.stateValues[0], q.tier === "HISTORY" ? "PATIENT_REPORTED" : "OBSERVED")
      );
      expect(r.status, q.featureId).toBe(200);
      body = r.body;
      expect(JSON.stringify(body), q.featureId).not.toMatch(/shadow/i);
    }

    const sources = await get("/sources");
    const indexed = new Set<string>(sources.body.citations.map((c: any) => c.id));

    const emitted = new Set<string>();
    for (const rec of body.trace) {
      for (const c of rec.citations) emitted.add(c.citationId as string);
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const cid of emitted) {
      expect(indexed.has(cid), `trace cites ${cid}, missing from /sources`).toBe(true);
    }
  });
});