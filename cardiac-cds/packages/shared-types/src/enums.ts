/**
 * Enums transcribed verbatim from CDS-CV-FOUNDATION-SPEC-v1.0.
 * Do not add values here without amending the spec first — this file is the
 * single source of truth every package (builder, engine, api) imports from.
 */

export const EVIDENCE_TIERS = ["HISTORY", "BEDSIDE", "NEAR_BEDSIDE", "IMAGING"] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export const CONDITION_CLASSES = ["CANDIDATE", "SHADOW", "SHADOW_DANGEROUS"] as const;
export type ConditionClass = (typeof CONDITION_CLASSES)[number];

export const VISIBILITY = ["REPORTED", "HIDDEN_IN_UNKNOWN", "HIDDEN_UNLESS_THRESHOLD"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const VERIFICATION_STATUS = ["unverified", "clinician_verified", "locally_calibrated"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];

export const INVASIVENESS = ["NONE", "MINOR", "SIGNIFICANT"] as const;
export type Invasiveness = (typeof INVASIVENESS)[number];

export const CITATION_TYPES = [
  "PRIMARY_STUDY",
  "SYSTEMATIC_REVIEW",
  "GUIDELINE",
  "EXPERT_CONSENSUS",
  "LOCAL_AUDIT",
] as const;
export type CitationType = (typeof CITATION_TYPES)[number];

export const EVIDENCE_GRADES = ["A", "B", "C", "D"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export const CARE_SETTINGS = [
  "ED_UNDIFFERENTIATED_CHEST_PAIN",
  "PRIMARY_CARE_CHEST_PAIN",
  "PREHOSPITAL",
  "TELEHEALTH_TRIAGE",
] as const;
export type CareSetting = (typeof CARE_SETTINGS)[number];

export const PREGNANCY_STATUS = ["PREGNANT", "POSTPARTUM_6WK", "NOT_PREGNANT", "UNKNOWN", "NOT_APPLICABLE"] as const;
export type PregnancyStatus = (typeof PREGNANCY_STATUS)[number];

export const EVIDENCE_SOURCE = ["MEASURED", "OBSERVED", "PATIENT_REPORTED", "CARER_REPORTED", "RECORD"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCE)[number];
// NOTE: "INFERRED" deliberately excluded — §2.3 the engine rejects it.

export const OBSERVER_CONFIDENCE = ["HIGH", "MEDIUM", "LOW"] as const;
export type ObserverConfidence = (typeof OBSERVER_CONFIDENCE)[number];

export const ENGINE_STATUS = ["OK", "HALT_RED_FLAG", "INSUFFICIENT_SAFETY_DATA", "INVALID_INPUT"] as const;
export type EngineStatus = (typeof ENGINE_STATUS)[number];

export const DEFERRED_REASON_CODES = [
  "TIER_NOT_ALLOWED",
  "PREREQUISITE_UNMET",
  "ALREADY_ANSWERED",
  "NO_EXPECTED_YIELD",
  "DECISION_INSENSITIVE",
  "CONTRAINDICATED",
  "COST_EXCEEDS_BUDGET",
] as const;
export type DeferredReasonCode = (typeof DEFERRED_REASON_CODES)[number];

export const CONFIDENCE_ASSESSMENT = [
  "POOR_FIT_ALL_CANDIDATES",
  "INDETERMINATE",
  "LEANING",
  "CONVERGING",
] as const;
export type ConfidenceAssessment = (typeof CONFIDENCE_ASSESSMENT)[number];

export const TRACE_EVENT_TYPES = [
  "SESSION_CREATED",
  "EVIDENCE_RECEIVED",
  "EVIDENCE_CONFLICT",
  "RED_FLAG_EVALUATED",
  "RED_FLAG_FIRED",
  "RED_FLAG_UNEVALUABLE",
  "PRIOR_NORMALISED",
  "BELIEF_UPDATE",
  "FIT_SCORE_COMPUTED",
  "QUESTION_SELECTED",
  "QUESTION_DEFERRED",
  "SHADOW_AGGREGATED",
  "SHADOW_VEIL_BROKEN",
  "HALT",
  "REPORT_EMITTED",
] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export const SEVERITY = ["INFO", "WARN", "ERROR", "SAFETY"] as const;
export type Severity = (typeof SEVERITY)[number];

export const CONDITION_IDS = [
  "PULMONARY_EMBOLISM",
  "UNSTABLE_ANGINA",
  "CONGESTIVE_HEART_FAILURE",
  "ACUTE_PERICARDITIS",
  "SHADOW_ANXIETY_PANIC",
  "SHADOW_MUSCULOSKELETAL",
  "SHADOW_GORD",
  "SHADOW_DANGEROUS_OOS",
  "SHADOW_OTHER",
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export const CANDIDATE_IDS = [
  "PULMONARY_EMBOLISM",
  "UNSTABLE_ANGINA",
  "CONGESTIVE_HEART_FAILURE",
  "ACUTE_PERICARDITIS",
] as const;
export type CandidateId = (typeof CANDIDATE_IDS)[number];

export const SHADOW_IDS = [
  "SHADOW_ANXIETY_PANIC",
  "SHADOW_MUSCULOSKELETAL",
  "SHADOW_GORD",
  "SHADOW_DANGEROUS_OOS",
  "SHADOW_OTHER",
] as const;
export type ShadowId = (typeof SHADOW_IDS)[number];

// Red flag rule IDs, RF-01..RF-16, per §4.3. Kept as a plain string pattern
// rather than a literal union so the builder/engine don't need a code change
// if the clinical lead adds RF-17 — but the pack builder validates the pattern.
export type RedFlagId = `RF-${string}`;
