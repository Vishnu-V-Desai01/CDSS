import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack } from "./loadPack.js";
import { validateCondition, validateCitations, validateFeaturesRegistry, formatAjvErrors } from "./validators.js";
import { runAllCrossChecks } from "./crossChecks.js";

export interface ValidateOptions {
  requireVerified?: boolean;
}

export interface ValidateReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePack(packDir: string, opts: ValidateOptions = {}): ValidateReport {
  const pack = loadPack(packDir);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (pack.conditions.length === 0) {
    errors.push(`${packDir}: no condition files found under conditions/ or shadows/.`);
  }

  // 1. Schema validation, per file.
  for (const file of pack.conditions) {
    const valid = validateCondition(file.data);
    if (!valid) errors.push(...formatAjvErrors(validateCondition.errors, file.path));
  }
  if (!validateCitations(pack.citations.data)) {
    errors.push(...formatAjvErrors(validateCitations.errors, pack.citations.path));
  }
  if (!validateFeaturesRegistry(pack.featuresRegistry.data)) {
    errors.push(...formatAjvErrors(validateFeaturesRegistry.errors, pack.featuresRegistry.path));
  }

  // Cross-checks assume schema-valid input; skip them if schema already failed
  // to avoid a wall of derived noise on top of the root cause.
  if (errors.length === 0) {
    const crossCheck = runAllCrossChecks(pack, { requireVerified: opts.requireVerified ?? false });
    errors.push(...crossCheck.errors);
    warnings.push(...crossCheck.warnings);
  }

  // Nine-hypothesis completeness check (spec §5.2 / §6 acceptance checklist).
  if (errors.length === 0) {
    const expectedIds = [
      "PULMONARY_EMBOLISM", "UNSTABLE_ANGINA", "CONGESTIVE_HEART_FAILURE", "ACUTE_PERICARDITIS",
      "SHADOW_ANXIETY_PANIC", "SHADOW_MUSCULOSKELETAL", "SHADOW_GORD", "SHADOW_DANGEROUS_OOS", "SHADOW_OTHER",
    ];
    const present = new Set(pack.conditions.map((f) => f.data.condition_id));
    const missing = expectedIds.filter((id) => !present.has(id as never));
    if (missing.length > 0) {
      warnings.push(`Pack is missing hypotheses: ${missing.join(", ")} (expected all nine, per spec §5.2).`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Canonical JSON stringify: sorted keys, so the hash is stable regardless of authoring order. */
function canonicalStringify(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, sortKeys(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

export function buildPack(packDir: string, outDir: string, packVersion: string, opts: ValidateOptions = {}) {
  const report = validatePack(packDir, opts);
  if (!report.ok) {
    return { report, packJsonPath: null, hash: null };
  }

  const pack = loadPack(packDir);
  const compiled = {
    knowledge_pack_version: packVersion,
    conditions: Object.fromEntries(pack.conditions.map((f) => [f.data.condition_id, f.data])),
    citations: pack.citations.data,
  };

  const canonical = canonicalStringify(compiled);
  const hash = "sha256:" + createHash("sha256").update(canonical).digest("hex");

  mkdirSync(outDir, { recursive: true });
  const packJsonPath = join(outDir, "pack.json");
  writeFileSync(packJsonPath, JSON.stringify({ ...compiled, knowledge_pack_hash: hash }, null, 2));

  return { report, packJsonPath, hash };
}
