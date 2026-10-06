// packages/api/src/__tests__/sources.scope.test.ts
/**
 * /sources must itemise only the four reportable conditions, must never name
 * a shadow condition, and must still resolve every citation it points at.
 * Runs against the REAL compiled pack.json.   Build first: npm run pack:build
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { CANDIDATE_IDS } from "@cds/shared-types";
import { loadPack, type LoadedPack } from "../packLoader.js";
import { buildSourcesResponse, type SourcesResponse } from "../sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");

let pack: LoadedPack;
let sources: SourcesResponse;

const inScope = new Set<string>(CANDIDATE_IDS);

beforeAll(async () => {
  pack = await loadPack(PACK_PATH);
  sources = buildSourcesResponse(pack);
});

function shadowConditions() {
  return Object.values(pack.conditions).filter((c) => !inScope.has(c.condition_id));
}

describe("/sources scope", () => {
  it("itemises only the four reportable conditions", () => {
    const ids = new Set([
      ...sources.featureLikelihoods.map((e) => e.conditionId),
      ...sources.priors.map((e) => e.conditionId),
    ]);
    expect([...ids].sort()).toEqual([...CANDIDATE_IDS].sort());
  });

  it("the pack really does contain shadows, so this test is not vacuous", () => {
    expect(shadowConditions().length).toBeGreaterThan(0);
  });

  it("never mentions a shadow condition id or display name anywhere", () => {
    const json = JSON.stringify(sources).toLowerCase();
    for (const shadow of shadowConditions()) {
      expect(json, shadow.condition_id).not.toContain(shadow.condition_id.toLowerCase());
      expect(json, `display name of ${shadow.condition_id}`).not.toContain(
        shadow.display_name.toLowerCase()
      );
    }
    expect(json).not.toContain("shadow");
  });

  it("reports how many values sit behind UNKNOWN, matching the pack", () => {
    const expected = shadowConditions().reduce(
      (n, c) =>
        n +
        Object.values(c.priors).filter((p) => p !== undefined).length +
        c.features.reduce((m, f) => m + f.states.length, 0),
      0
    );
    expect(sources.unknownAggregate.itemised).toBe(false);
    expect(sources.unknownAggregate.valueCount).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});

describe("/sources citations", () => {
  it("every citation a row points at is in the citation index", () => {
    const indexed = new Set(sources.citations.map((c) => c.id));
    for (const row of sources.featureLikelihoods) {
      if (row.citation) expect(indexed.has(row.citation.id), row.featureId).toBe(true);
    }
    for (const row of sources.priors) {
      if (row.citation) expect(indexed.has(row.citation.id), row.conditionId).toBe(true);
    }
  });

  it("usedBy lists only reportable conditions", () => {
    for (const c of sources.citations) {
      for (const id of c.usedBy) expect(inScope.has(id), `${c.id} -> ${id}`).toBe(true);
    }
  });

  it("citations behind the UNKNOWN aggregate stay reachable", () => {
    const behindUnknown = sources.citations.filter((c) => c.usedInUnknownAggregate);
    expect(behindUnknown.length).toBeGreaterThan(0);
  });

  it("grades are shown as recorded, A to D", () => {
    for (const c of sources.citations) {
      expect(["A", "B", "C", "D"]).toContain(c.evidenceGrade);
    }
  });

  it("priors carry the population they were drawn from", () => {
    expect(sources.priors.length).toBeGreaterThan(0);
    for (const p of sources.priors) {
      expect(typeof p.population).toBe("string");
      expect(p.population.length).toBeGreaterThan(0);
    }
  });
});