// packages/safety-gate/src/gate.ts
/**
 * Safety gate: evaluate red-flag rules deterministically per spec §4.3.
 *
 * Per spec §4.1:
 *   - Evaluated BEFORE inference
 *   - All firing rules are reported; lowest-numbered is primary_rule
 *   - Missing data does NOT fire and does NOT suppress a halt
 *   - Returns HALT or PROCEED only
 *
 * Gate receives canonicalised evidence (categorical states, not raw vitals).
 */

import type { RedFlagRule } from "@cds/shared-types";

export interface GateInput {
  evidence: Record<string, string>; // feature_id → canonical state
  redFlags: Record<string, RedFlagRule>;
}

export interface GateResult {
  status: "PROCEED" | "HALT";
  firedRules: string[]; // IDs of rules that fired, in ascending order
  unevaluableRules: Array<{
    ruleId: string;
    missingFeatures: string[];
  }>;
  primaryRule: string | null; // lowest-numbered fired rule, or null
}

/**
 * Evaluate all red-flag rules over canonicalised evidence.
 */
export function evaluateGate(input: GateInput): GateResult {
  const { evidence, redFlags } = input;

  const firedRules: string[] = [];
  const unevaluableRules: Array<{ ruleId: string; missingFeatures: string[] }> = [];

  // Evaluate in ascending ID order (determinism per §3.3)
  const sortedRules = Object.values(redFlags).sort((a, b) =>
    a.flag_id.localeCompare(b.flag_id),
  );

  for (const rule of sortedRules) {
    const { fires, missingFeatures } = evaluateSingleRule(rule, evidence);

    if (fires === true) {
      firedRules.push(rule.flag_id);
    } else if (missingFeatures.length > 0) {
      unevaluableRules.push({
        ruleId: rule.flag_id,
        missingFeatures,
      });
    }
    // fires === false means rule evaluated but did not fire; not reported
  }

  return {
    status: firedRules.length > 0 ? "HALT" : "PROCEED",
    firedRules,
    unevaluableRules,
    primaryRule: firedRules[0] ?? null,
  };
}

/**
 * Evaluate a single rule.
 *
 * Returns:
 *   - { fires: true } — all inputs present and condition met → HALT
 *   - { fires: false, missingFeatures: [] } — all inputs present but condition not met
 *   - { fires: false, missingFeatures: [...] } — one or more inputs missing → unevaluable
 *
 * Per spec §4.1: missing data never fires and never suppresses a halt.
 */
function evaluateSingleRule(
  rule: RedFlagRule,
  evidence: Record<string, string>,
): { fires: boolean; missingFeatures: string[] } {
  const missingFeatures: string[] = [];

  // Check inputs
  for (const trigger of rule.triggers) {
    if (!(trigger.finding_id in evidence)) {
      missingFeatures.push(trigger.finding_id);
    }
  }

  // Unevaluable if any input missing
  if (missingFeatures.length > 0) {
    return { fires: false, missingFeatures };
  }

  // Evaluate trigger_logic
  if (rule.trigger_logic === "ALL") {
    const allMatch = rule.triggers.every(
      (t) => evidence[t.finding_id] === t.required_state,
    );
    return { fires: allMatch, missingFeatures: [] };
  } else if (rule.trigger_logic === "ANY") {
    const anyMatch = rule.triggers.some(
      (t) => evidence[t.finding_id] === t.required_state,
    );
    return { fires: anyMatch, missingFeatures: [] };
  } else {
    throw new Error(`Unknown trigger_logic: ${rule.trigger_logic}`);
  }
}