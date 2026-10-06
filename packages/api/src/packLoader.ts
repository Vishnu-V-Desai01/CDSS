// packages/api/src/packLoader.ts
/**
 * Knowledge pack loader - startup-time only.
 *
 * Per spec sec. 1.1: "A session may not span two packs" and every response
 * must cite knowledge_pack_hash. This loader reads pack.json ONCE at
 * server boot, validates its top-level shape, and holds it in memory for
 * the lifetime of the process. There is no hot-reload.
 *
 * Fail fast: if the pack is missing or malformed, the server does not
 * start.
 */

import { readFile } from "fs/promises";
import type {
  ConditionFile,
  CitationsFile,
  RedFlagsFile,
  FeatureRegistryFile,
} from "@cds/shared-types";

export interface LoadedPack {
  knowledgePackVersion: string;
  knowledgePackHash: string;
  conditions: Record<string, ConditionFile>;
  citations: CitationsFile;
  redFlags: RedFlagsFile;
  featuresRegistry: FeatureRegistryFile;
}

export class PackLoadError extends Error {
  constructor(reason: string) {
    super(`Failed to load knowledge pack: ${reason}`);
    this.name = "PackLoadError";
  }
}

const REQUIRED_TOP_LEVEL_KEYS = [
  "knowledge_pack_version",
  "knowledge_pack_hash",
  "conditions",
  "citations",
  "red_flags",
  "features_registry",
] as const;

const REQUIRED_CANDIDATE_IDS = [
  "PULMONARY_EMBOLISM",
  "UNSTABLE_ANGINA",
  "CONGESTIVE_HEART_FAILURE",
  "ACUTE_PERICARDITIS",
] as const;

export async function loadPack(packPath: string): Promise<LoadedPack> {
  let raw: string;
  try {
    raw = await readFile(packPath, "utf-8");
  } catch (err) {
    throw new PackLoadError(`cannot read file at ${packPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PackLoadError(`invalid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new PackLoadError("pack.json root is not an object");
  }

  const pack = parsed as Record<string, unknown>;

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in pack)) {
      throw new PackLoadError(
        `missing required top-level key: "${key}"` +
          (key === "features_registry" ? " (rebuild with: npm run pack:build)" : "")
      );
    }
  }

  const conditions = pack.conditions as Record<string, ConditionFile>;

  for (const candidateId of REQUIRED_CANDIDATE_IDS) {
    const condition = conditions[candidateId];
    if (!condition) {
      throw new PackLoadError(
        `missing required candidate condition: "${candidateId}". ` +
          `A pack without all four candidates cannot serve the differential.`
      );
    }
    if (condition.enabled !== true) {
      throw new PackLoadError(
        `candidate condition "${candidateId}" has enabled: false. ` +
          `Refusing to serve a differential missing a required candidate.`
      );
    }
  }

  const redFlags = pack.red_flags as RedFlagsFile;
  if (Object.keys(redFlags).length === 0) {
    throw new PackLoadError(
      "red_flags is empty. Refusing to start a server with no safety gate rules - " +
        "this would mean every session proceeds to inference regardless of vitals."
    );
  }

  const featuresRegistry = pack.features_registry as FeatureRegistryFile;
  if (
    typeof featuresRegistry !== "object" ||
    featuresRegistry === null ||
    Object.keys(featuresRegistry).length === 0
  ) {
    throw new PackLoadError(
      "features_registry is empty. Refusing to start: no question could be rendered."
    );
  }

  return {
    knowledgePackVersion: pack.knowledge_pack_version as string,
    knowledgePackHash: pack.knowledge_pack_hash as string,
    conditions,
    citations: pack.citations as CitationsFile,
    redFlags,
    featuresRegistry,
  };
}