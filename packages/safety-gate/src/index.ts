// packages/safety-gate/src/index.ts
export { canonicalise, checkMinimumSafetySet } from "./canonicaliser.js";
export type { PatientModifiers, CanonicalEvidenceState, CanonicaliserResult } from "./canonicaliser.js";

export { evaluateGate } from "./gate.js";
export type { GateInput, GateResult } from "./gate.js";