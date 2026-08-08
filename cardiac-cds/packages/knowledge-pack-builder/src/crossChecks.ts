import type { CitationsFile, ConditionFeature, ConditionFile, FeatureRegistryFile } from "@cds/shared-types";
import type { LoadedFile, LoadedPack } from "./loadPack.js";

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

function empty(): CheckResult {
  return { errors: [], warnings: [] };
}

function merge(...results: CheckResult[]): CheckResult {
  return {
    errors: results.flatMap((r) => r.errors),
    warnings: results.flatMap((r) => r.warnings),
  };
}

/**
 * §1.6 rule 2: if derived_from is present, the build fails when the stored lr
 * differs from the recomputed LR by more than 5%. Convention: for a binary
 * PRESENT/ABSENT feature, PRESENT is checked against LR+ = sens / (1 - spec),
 * ABSENT is checked against LR- = (1 - sens) / spec. Other state values are
 * not auto-checked (no fixed convention for ordinal bands) and must carry a
 * citation but are exempt from this specific tolerance check.
 */
export function checkLrDerivation(file: LoadedFile<ConditionFile>): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const feature of file.data.features) {
    for (const state of feature.states) {
      if (!state.derived_from) continue;
      const { sensitivity: sens, specificity: spec } = state.derived_from;

      let expected: number | null = null;
      if (state.value === "PRESENT") {
        if (spec >= 1) {
          warnings.push(
            `${file.path}: ${feature.feature_id}.PRESENT has specificity=1, LR+ is undefined — cannot verify.`,
          );
          continue;
        }
        expected = sens / (1 - spec);
      } else if (state.value === "ABSENT") {
        if (spec <= 0) {
          warnings.push(
            `${file.path}: ${feature.feature_id}.ABSENT has specificity=0, LR- is undefined — cannot verify.`,
          );
          continue;
        }
        expected = (1 - sens) / spec;
      } else {
        continue; // no fixed convention for ordinal/other states
      }

      const pctDiff = Math.abs(state.lr - expected) / expected;
      if (pctDiff > 0.05) {
        errors.push(
          `${file.path}: ${feature.feature_id}.${state.value} lr=${state.lr} but derived_from ` +
            `implies ${expected.toFixed(3)} (${(pctDiff * 100).toFixed(1)}% off, tolerance 5%). ` +
            `Check the transcription against the source table.`,
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * §1.6 rule 4: lr === 1.0 is the only case where citation_id may be null.
 * (Schema already enforces this structurally; this re-checks with float
 * tolerance since JSON Schema's const comparison on floats is brittle.)
 */
export function checkCitationRequired(file: LoadedFile<ConditionFile>): CheckResult {
  const errors: string[] = [];
  for (const feature of file.data.features) {
    for (const state of feature.states) {
      const isUnity = Math.abs(state.lr - 1.0) < 1e-9;
      if (!isUnity && !state.citation_id) {
        errors.push(
          `${file.path}: ${feature.feature_id}.${state.value} has lr=${state.lr} (not 1.0) but citation_id is null.`,
        );
      }
    }
  }
  return { errors, warnings: [] };
}

/** Every citation_id used anywhere must resolve in citations.yaml. */
export function checkCitationsResolve(pack: LoadedPack): CheckResult {
  const errors: string[] = [];
  const known = new Set(Object.keys(pack.citations.data ?? {}));

  const check = (id: string | null, where: string) => {
    if (id && !known.has(id)) {
      errors.push(`${where}: citation_id "${id}" not found in ${pack.citations.path}`);
    }
  };

  for (const file of pack.conditions) {
    for (const [, prior] of Object.entries(file.data.priors ?? {})) {
      check(prior.citation_id, `${file.path} priors`);
    }
    for (const feature of file.data.features) {
      for (const state of feature.states) {
        check(state.citation_id, `${file.path} ${feature.feature_id}.${state.value}`);
      }
    }
  }

  return { errors, warnings: [] };
}

/**
 * §1.6 rule 3: feature_id, prompt, tier, dependency_group and states[].value
 * must be byte-identical to the registry across every condition file that
 * uses that feature. Only lr/derived_from/citation_id may differ per file.
 */
export function checkFeatureRegistryIdentity(pack: LoadedPack): CheckResult {
  const errors: string[] = [];
  const registry: FeatureRegistryFile = pack.featuresRegistry.data ?? {};

  for (const file of pack.conditions) {
    for (const feature of file.data.features) {
      const canonical = registry[feature.feature_id];
      if (!canonical) {
        errors.push(
          `${file.path}: feature_id "${feature.feature_id}" is not declared in ${pack.featuresRegistry.path}. ` +
            `Add it to the registry first — condition files may not invent wording.`,
        );
        continue;
      }

      if (canonical.tier !== feature.tier) {
        errors.push(
          `${file.path}: ${feature.feature_id} tier="${feature.tier}" but registry says "${canonical.tier}".`,
        );
      }
      if ((canonical.dependency_group ?? null) !== (feature.dependency_group ?? null)) {
        errors.push(
          `${file.path}: ${feature.feature_id} dependency_group="${feature.dependency_group}" ` +
            `but registry says "${canonical.dependency_group}".`,
        );
      }

      const fileStates = new Set(feature.states.map((s) => s.value));
      const registryStates = new Set(canonical.state_values);
      const missing = [...registryStates].filter((v) => !fileStates.has(v));
      const extra = [...fileStates].filter((v) => !registryStates.has(v));
      if (missing.length > 0) {
        errors.push(
          `${file.path}: ${feature.feature_id} is missing states [${missing.join(", ")}] declared in the registry.`,
        );
      }
      if (extra.length > 0) {
        errors.push(
          `${file.path}: ${feature.feature_id} has states [${extra.join(", ")}] not in the registry — ` +
            `either a typo or the registry needs updating first.`,
        );
      }
    }
  }

  return { errors, warnings: [] };
}

/** A feature's dependency_group must be declared in that same file's dependency_groups list. */
export function checkDependencyGroupsDeclared(file: LoadedFile<ConditionFile>): CheckResult {
  const errors: string[] = [];
  const declared = new Set(file.data.dependency_groups.map((g) => g.group_id));
  for (const feature of file.data.features) {
    if (feature.dependency_group && !declared.has(feature.dependency_group)) {
      errors.push(
        `${file.path}: ${feature.feature_id} references dependency_group "${feature.dependency_group}" ` +
          `which is not declared in this file's dependency_groups list.`,
      );
    }
  }
  return { errors, warnings: [] };
}

/** No duplicate feature_id within one condition file. */
export function checkNoDuplicateFeatures(file: LoadedFile<ConditionFile>): CheckResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const feature of file.data.features) {
    if (seen.has(feature.feature_id)) {
      errors.push(`${file.path}: duplicate feature_id "${feature.feature_id}".`);
    }
    seen.add(feature.feature_id);
  }
  return { errors, warnings: [] };
}

/** §0.3: production builds must reject any unverified numeric default. */
export function checkVerificationStatus(file: LoadedFile<ConditionFile>, requireVerified: boolean): CheckResult {
  if (!requireVerified) return empty();
  const errors: string[] = [];
  const unverified: string[] = [];

  const flag = (label: string, status: string) => {
    if (status === "unverified") unverified.push(label);
  };

  flag("condition_file", file.data.verification_status);
  for (const [setting, prior] of Object.entries(file.data.priors ?? {})) {
    flag(`prior[${setting}]`, prior.verification_status);
  }
  for (const feature of file.data.features) {
    flag(`feature[${feature.feature_id}]`, feature.verification_status);
  }

  if (unverified.length > 0) {
    errors.push(
      `${file.path}: --require-verified set but the following are still "unverified": ${unverified.join(", ")}`,
    );
  }

  return { errors, warnings: [] };
}

export function runAllCrossChecks(pack: LoadedPack, opts: { requireVerified: boolean }): CheckResult {
  const perFile = pack.conditions.map((file) =>
    merge(
      checkLrDerivation(file),
      checkCitationRequired(file),
      checkDependencyGroupsDeclared(file),
      checkNoDuplicateFeatures(file),
      checkVerificationStatus(file, opts.requireVerified),
    ),
  );

  return merge(...perFile, checkCitationsResolve(pack), checkFeatureRegistryIdentity(pack));
}
