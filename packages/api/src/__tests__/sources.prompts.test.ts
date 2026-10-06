// packages/api/src/__tests__/sources.prompts.test.ts
/** Every itemised row carries its registry wording, and none names a hidden condition. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { loadPack, type LoadedPack } from "../packLoader.js";
import { buildSourcesResponse, type SourcesResponse } from "../sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(__dirname, "../../../knowledge-packs/cv-v1/dist/pack.json");
const HIDDEN_WORDING = /anxiety|panic|musculoskeletal|reflux|gord|shadow/i;

let pack: LoadedPack;
let sources: SourcesResponse;

beforeAll(async () => {
  pack = await loadPack(PACK_PATH);
  sources = buildSourcesResponse(pack);
});

describe("/sources finding wording", () => {
  it("every likelihood row carries the registry prompt for its finding", () => {
    expect(sources.featureLikelihoods.length).toBeGreaterThan(0);
    for (const row of sources.featureLikelihoods) {
      expect(row.featurePrompt, row.featureId).toBe(pack.featuresRegistry[row.featureId]!.prompt);
    }
  });

  it("no served prompt names a hidden condition", () => {
    for (const row of sources.featureLikelihoods) {
      expect(row.featurePrompt ?? "", row.featureId).not.toMatch(HIDDEN_WORDING);
    }
  });
});