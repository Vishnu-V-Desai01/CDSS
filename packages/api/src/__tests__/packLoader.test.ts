// packages/api/src/__tests__/packLoader.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPack, PackLoadError } from "../packLoader.js";

/** Minimal pack that satisfies every check in loadPack. */
function makeValidPack(): Record<string, any> {
  const candidate = (id: string) => ({
    condition_id: id,
    display_name: id,
    class: "CANDIDATE",
    enabled: true,
  });

  return {
    knowledge_pack_version: "test.0",
    knowledge_pack_hash: "sha256:test",
    conditions: {
      PULMONARY_EMBOLISM: candidate("PULMONARY_EMBOLISM"),
      UNSTABLE_ANGINA: candidate("UNSTABLE_ANGINA"),
      CONGESTIVE_HEART_FAILURE: candidate("CONGESTIVE_HEART_FAILURE"),
      ACUTE_PERICARDITIS: candidate("ACUTE_PERICARDITIS"),
    },
    citations: {},
    red_flags: {
      "RF-01": {
        flag_id: "RF-01",
        display_name: "Test flag",
        clinical_rationale: "test",
        triggers: [],
        trigger_logic: "ALL",
        halt_message: "test",
        confidence: "CERTAIN",
      },
    },
    features_registry: {
      SOME_FEATURE: {
        feature_id: "SOME_FEATURE",
        prompt: "Is this a test question?",
        tier: "HISTORY",
        dependency_group: null,
        state_values: ["PRESENT", "ABSENT"],
      },
    },
  };
}

async function withTempPack(
  content: string,
  fn: (path: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cds-pack-"));
  const path = join(dir, "pack.json");
  try {
    await writeFile(path, content, "utf-8");
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("Pack Loader", () => {
  it("loads a valid pack successfully", async () => {
    await withTempPack(JSON.stringify(makeValidPack()), async (path) => {
      const pack = await loadPack(path);
      expect(pack.knowledgePackVersion).toBe("test.0");
      expect(pack.knowledgePackHash).toBe("sha256:test");
      expect(Object.keys(pack.conditions)).toHaveLength(4);
      expect(Object.keys(pack.redFlags)).toEqual(["RF-01"]);
      expect(pack.featuresRegistry["SOME_FEATURE"]?.prompt).toBe(
        "Is this a test question?"
      );
    });
  });

  it("throws PackLoadError when file does not exist", async () => {
    const promise = loadPack(join(tmpdir(), "definitely-not-here", "pack.json"));
    await expect(promise).rejects.toBeInstanceOf(PackLoadError);
    await expect(promise).rejects.toThrow(/cannot read file/);
  });

  it("throws PackLoadError on invalid JSON", async () => {
    await withTempPack("{ not json", async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/invalid JSON/);
    });
  });

  it("throws PackLoadError when the root is not an object", async () => {
    await withTempPack("null", async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/not an object/);
    });
  });

  it.each([
    "knowledge_pack_version",
    "knowledge_pack_hash",
    "conditions",
    "citations",
    "red_flags",
    "features_registry",
  ])("throws PackLoadError when required top-level key %s is missing", async (key) => {
    const broken = makeValidPack();
    delete broken[key];
    await withTempPack(JSON.stringify(broken), async (path) => {
      await expect(loadPack(path)).rejects.toThrow(
        new RegExp(`missing required top-level key: "${key}"`)
      );
    });
  });

  it("throws PackLoadError when a required candidate condition is missing", async () => {
    const broken = clone(makeValidPack());
    delete broken.conditions.PULMONARY_EMBOLISM;
    await withTempPack(JSON.stringify(broken), async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/missing required candidate condition/);
    });
  });

  it("throws PackLoadError when a candidate condition is disabled", async () => {
    const broken = clone(makeValidPack());
    broken.conditions.UNSTABLE_ANGINA.enabled = false;
    await withTempPack(JSON.stringify(broken), async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/enabled: false/);
    });
  });

  it("throws PackLoadError when red_flags is empty", async () => {
    const broken = { ...makeValidPack(), red_flags: {} };
    await withTempPack(JSON.stringify(broken), async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/red_flags is empty/);
    });
  });

  it("throws PackLoadError when features_registry is empty", async () => {
    const broken = { ...makeValidPack(), features_registry: {} };
    await withTempPack(JSON.stringify(broken), async (path) => {
      await expect(loadPack(path)).rejects.toThrow(/features_registry is empty/);
    });
  });
});