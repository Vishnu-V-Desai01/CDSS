import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { CitationsFile, ConditionFile, FeatureRegistryFile } from "@cds/shared-types";

export interface LoadedFile<T> {
  path: string;
  data: T;
}

function readYaml<T>(path: string): T {
  return yaml.load(readFileSync(path, "utf8")) as T;
}

function listYamlFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(dir, f));
}

export interface LoadedPack {
  conditions: LoadedFile<ConditionFile>[];
  citations: LoadedFile<CitationsFile>;
  featuresRegistry: LoadedFile<FeatureRegistryFile>;
}

/**
 * A pack directory looks like:
 *   <packDir>/conditions/*.knowledge.yaml
 *   <packDir>/shadows/*.knowledge.yaml
 *   <packDir>/citations.yaml
 *   <packDir>/features.registry.yaml
 */
export function loadPack(packDir: string): LoadedPack {
  const conditionPaths = [
    ...listYamlFiles(join(packDir, "conditions")),
    ...listYamlFiles(join(packDir, "shadows")),
  ];

  const conditions = conditionPaths.map((path) => ({
    path,
    data: readYaml<ConditionFile>(path),
  }));

  const citationsPath = join(packDir, "citations.yaml");
  const registryPath = join(packDir, "features.registry.yaml");

  return {
    conditions,
    citations: { path: citationsPath, data: readYaml<CitationsFile>(citationsPath) },
    featuresRegistry: { path: registryPath, data: readYaml<FeatureRegistryFile>(registryPath) },
  };
}
