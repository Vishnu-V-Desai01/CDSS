import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// ---------- Types ----------

interface FeatureState {
  state_value: string;
  lr: number;
  derived_from?: { sensitivity: number; specificity: number };
  citation_id?: string;
  verification_status?: "unverified" | "verified";
  note?: string;
}

interface Finding {
  feature_id: string;
  states: FeatureState[];
}

interface ConditionFile {
  condition_id: string;
  display_name: string;
  description: string;
  verification_status?: "unverified" | "verified";
  prior_probabilities: Record<string, number>;
  findings: Finding[];
  dependency_groups: Record<string, { redundancy_lambda?: number; rationale: string }>;
  expected_profile?: Array<{ feature_id: string; expected_states: string[]; weight: number; hallmark?: boolean }>;
  investigation_costs?: { findings_by_cost?: Record<string, string[]> };
}

interface FeatureRegistryEntry {
  feature_id: string;
  prompt: string;
  tier: string;
  dependency_group: string | null;
  state_values: string[];
}

interface CitationEntry {
  type: string;
  title: string;
  authors: string;
  year: number;
  doi?: string;
  pmid?: string;
  evidence_grade: string;
  table_or_figure: string;
  extracted_by: string;
  extracted_on: string;
  checked_by: string | null;
  notes?: string;
}

// ---------- Setup ----------

const ROOT = __dirname.replace(/scripts$/, "");
const REQUIRE_VERIFIED = process.argv.includes("--require-verified");

let errorCount = 0;
let warningCount = 0;

function error(msg: string) {
  console.error(`ERROR: ${msg}`);
  errorCount++;
}

function warn(msg: string) {
  console.warn(`WARNING: ${msg}`);
  warningCount++;
}

function loadYaml<T>(relPath: string): T {
  const fullPath = path.join(ROOT, relPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return yaml.load(raw) as T;
}

// ---------- Load shared files ----------

const featuresRegistry = loadYaml<Record<string, FeatureRegistryEntry>>("features.registry.yaml");
const citations = loadYaml<Record<string, CitationEntry>>("citations.yaml");

const conditionsDir = path.join(ROOT, "conditions");
const conditionFiles = fs.readdirSync(conditionsDir).filter((f) => f.endsWith(".knowledge.yaml"));

console.log(`Found ${conditionFiles.length} condition file(s): ${conditionFiles.join(", ")}`);
console.log(`Feature registry: ${Object.keys(featuresRegistry).length} features`);
console.log(`Citations: ${Object.keys(citations).length} sources\n`);

// ---------- Validate each condition file ----------

for (const file of conditionFiles) {
  console.log(`--- Validating ${file} ---`);
  const condition = loadYaml<ConditionFile>(path.join("conditions", file));

  const referencedFeatureIds = new Set<string>();
  let allFindingsVerified = true;

  // Rule 6: prior_probabilities > 0
  for (const [setting, weight] of Object.entries(condition.prior_probabilities)) {
    if (weight <= 0) {
      error(`${file}: prior_probabilities.${setting} must be > 0, got ${weight}`);
    }
    if (!["ED", "ICU", "WARD", "OUTPATIENT"].includes(setting)) {
      error(`${file}: prior_probabilities key "${setting}" is not one of ED/ICU/WARD/OUTPATIENT`);
    }
  }

  // Rule 1 + 2 + 3 + 4 + 5: per-finding checks
  for (const finding of condition.findings) {
    referencedFeatureIds.add(finding.feature_id);

    const registryEntry = featuresRegistry[finding.feature_id];
    if (!registryEntry) {
      error(`${file}: feature_id "${finding.feature_id}" not found in features.registry.yaml`);
      continue;
    }

    for (const state of finding.states) {
      // Rule 5: state_value must be valid for this feature
      if (!registryEntry.state_values.includes(state.state_value)) {
        error(
          `${file}: ${finding.feature_id}.${state.state_value} is not a valid state_value. ` +
            `Registry allows: [${registryEntry.state_values.join(", ")}]`
        );
      }

      // Rule 2 + 3: citation + LR cross-check for lr != 1.0
      if (state.lr !== 1.0) {
        if (!state.citation_id) {
          error(`${file}: ${finding.feature_id}.${state.state_value} has lr=${state.lr} but no citation_id`);
        } else if (!citations[state.citation_id]) {
          error(
            `${file}: ${finding.feature_id}.${state.state_value} citation_id "${state.citation_id}" not found in citations.yaml`
          );
        }

        if (!state.derived_from) {
          error(`${file}: ${finding.feature_id}.${state.state_value} has lr=${state.lr} but no derived_from block`);
        } else {
          const { sensitivity, specificity } = state.derived_from;
          if (specificity >= 1.0) {
            error(
              `${file}: ${finding.feature_id}.${state.state_value} has specificity=1.0, ` +
                `computed LR is undefined (division by zero)`
            );
          } else {
            const computedLr = sensitivity / (1 - specificity);
            const relError = Math.abs(computedLr - state.lr) / computedLr;
            if (relError > 0.05) {
              error(
                `${file}: ${finding.feature_id}.${state.state_value} LR MISMATCH — ` +
                  `stored lr=${state.lr}, computed lr=${computedLr.toFixed(3)} ` +
                  `(sens=${sensitivity}, spec=${specificity}), ` +
                  `relative error=${(relError * 100).toFixed(1)}% (tolerance 5%)`
              );
            }
          }
        }
      }

      // Rule 4: verification status tracking
      const status = state.verification_status ?? "unverified";
      if (status !== "verified") {
        allFindingsVerified = false;
      }
      if (REQUIRE_VERIFIED && status !== "verified") {
        error(
          `${file}: ${finding.feature_id}.${state.state_value} is "${status}" — ` +
            `--require-verified requires all states to be "verified"`
        );
      }
    }
  }

  // Rule 1: expected_profile feature_id checks
  if (condition.expected_profile) {
    for (const item of condition.expected_profile) {
      if (!featuresRegistry[item.feature_id]) {
        error(`${file}: expected_profile references unknown feature_id "${item.feature_id}"`);
      }
    }
  }

  // Rule 1: investigation_costs feature_id checks
  if (condition.investigation_costs?.findings_by_cost) {
    for (const [costTier, ids] of Object.entries(condition.investigation_costs.findings_by_cost)) {
      for (const id of ids) {
        if (!referencedFeatureIds.has(id)) {
          warn(`${file}: investigation_costs.${costTier} references "${id}" which is not in this condition's findings[]`);
        }
      }
    }
  }

  // Rule 7: dependency_groups checks
  const groupMembership = new Map<string, string>(); // feature_id -> group_id
  for (const finding of condition.findings) {
    const registryEntry = featuresRegistry[finding.feature_id];
    if (registryEntry?.dependency_group) {
      if (!condition.dependency_groups[registryEntry.dependency_group]) {
        error(
          `${file}: feature "${finding.feature_id}" references dependency_group ` +
            `"${registryEntry.dependency_group}" which is not declared in this condition's dependency_groups`
        );
      }
      if (groupMembership.has(finding.feature_id)) {
        error(`${file}: feature "${finding.feature_id}" appears to belong to multiple dependency groups`);
      }
      groupMembership.set(finding.feature_id, registryEntry.dependency_group);
    }
  }

  for (const [groupId, group] of Object.entries(condition.dependency_groups)) {
    const membersInThisFile = [...groupMembership.entries()].filter(([, g]) => g === groupId);
    if (membersInThisFile.length === 0) {
      warn(`${file}: dependency_group "${groupId}" is declared but no findings reference it`);
    }
    const lambda = group.redundancy_lambda ?? 0.35;
    if (lambda < 0 || lambda > 1) {
      error(`${file}: dependency_group "${groupId}" redundancy_lambda=${lambda} out of range [0,1]`);
    }
  }

  // Top-level verification_status consistency
  const topStatus = condition.verification_status ?? "unverified";
  if (topStatus === "verified" && !allFindingsVerified) {
    error(`${file}: top-level verification_status is "verified" but not all finding states are "verified"`);
  }

  console.log(`  ${condition.findings.length} findings, ${referencedFeatureIds.size} unique features referenced\n`);
}

// ---------- Summary ----------

console.log("=".repeat(60));
console.log(`Validation complete: ${errorCount} error(s), ${warningCount} warning(s)`);
if (REQUIRE_VERIFIED) {
  console.log("(ran with --require-verified)");
}
console.log("=".repeat(60));

if (errorCount > 0) {
  process.exit(1);
}