import type {
  CandidateId,
  CareSetting,
  ConditionId,
  ConfidenceAssessment,
  DeferredReasonCode,
  EngineStatus,
  EvidenceSource,
  EvidenceTier,
  ObserverConfidence,
  PregnancyStatus,
  RedFlagId,
  Severity,
  TraceEventType,
} from "./enums.js";

// ---- Request (§2.3) ----

export interface EvidenceItem {
  feature_id: string;
  value: string;
  raw_value?: number | string;
  source: EvidenceSource;
  observed_at: string; // ISO 8601
  observer_confidence: ObserverConfidence;
}

export interface PatientInfo {
  age_years: number;
  sex_at_birth: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
  pregnancy_status?: PregnancyStatus;
  known_baseline_sbp?: number;
}

export interface EvaluateOptions {
  allowed_tiers?: EvidenceTier[];
  max_questions_returned?: number;
  return_trace?: boolean;
  return_shadow_composition?: boolean; // requires DEBUG_SHADOW scope, see §5.5
}

export interface EvaluateRequest {
  schema_version: string;
  care_setting: CareSetting;
  patient: PatientInfo;
  presenting_complaint: string[];
  evidence: EvidenceItem[];
  options?: EvaluateOptions;
}

// ---- Response (§2.4) ----

export interface TopContributor {
  feature_id: string;
  value: string;
  log_lr_applied: number;
  direction: "TOWARD" | "AWAY";
}

export interface PosteriorEntry {
  condition_id: CandidateId;
  probability: number;
  log_odds: number;
  prior_probability: number;
  log_odds_delta: number;
  fit_score: number | null;
  fit_status?: "INSUFFICIENT_OBSERVATIONS";
  top_contributors: TopContributor[];
}

export interface UnknownBlock {
  probability: number;
  composition_disclosed: boolean;
  interpretation: string;
  composition?: Record<string, number>; // only when return_shadow_composition + DEBUG_SHADOW scope
}

export interface ConfidenceBlock {
  max_fit_score: number | null;
  leader_margin: number;
  entropy_bits: number;
  assessment: ConfidenceAssessment;
}

export interface NextQuestion {
  feature_id: string;
  prompt: string;
  tier: EvidenceTier;
  expected_information_gain_bits: number;
  acquisition_cost: number;
  why: string;
}

export interface DeferredQuestion {
  feature_id: string;
  reason_code: DeferredReasonCode;
  tier?: EvidenceTier;
  prerequisite?: string;
}

export interface CompletenessBlock {
  features_in_pack: number;
  features_answered: number;
  coverage_by_tier: Record<EvidenceTier, number>;
  unanswered_high_value: string[];
  blocking_gaps: string[];
}

export interface SafetyBlock {
  red_flags_fired: RedFlagId[];
  red_flags_unevaluable: RedFlagId[];
  minimum_safety_set_complete: boolean;
  missing_safety_observations: string[];
}

export interface TraceAdjustment {
  type: "REDUNDANCY_DISCOUNT" | "CONFIDENCE_SHRINKAGE" | "CLAMP";
  group_id?: string;
  factor: number;
  reason: string;
}

export interface TraceEntry {
  seq: number;
  session_id: string;
  timestamp: string;
  event_type: TraceEventType;
  engine_version: string;
  knowledge_pack_hash: string;
  feature_id: string | null;
  value: string | null;
  source: EvidenceSource | null;
  observer_confidence: ObserverConfidence | null;
  condition_id: ConditionId | null;
  lr_raw: number | null;
  log_lr_raw: number | null;
  adjustments: TraceAdjustment[];
  log_lr_applied: number | null;
  clamp_applied: boolean;
  log_odds_before: number | null;
  log_odds_after: number | null;
  citation_id: string | null;
  rule_id: RedFlagId | null;
  severity: Severity;
  note: string | null;
}

export interface EscalationBlock {
  reason_code: "DANGEROUS_OUT_OF_SCOPE_THRESHOLD";
  probability: number;
  message: string;
  contributing_features: string[];
}

export interface HaltRuleFired {
  rule_id: RedFlagId;
  name: string;
  triggering_observations: Array<{
    feature_id: string;
    value: string | number;
    threshold: string;
    source: EvidenceSource;
    observed_at: string;
  }>;
}

export interface HaltBlock {
  primary_rule: RedFlagId;
  all_fired_rules: HaltRuleFired[];
  action: "ESCALATE_IMMEDIATELY";
  message: string;
  differential_suppressed: true;
  session_locked: true;
  override_available: false;
}

/** Base fields present on every response regardless of status. */
interface EvaluateResponseBase {
  schema_version: string;
  engine_version: string;
  knowledge_pack_version: string;
  knowledge_pack_hash: string;
  evaluated_at: string;
  status: EngineStatus;
  safety: SafetyBlock;
  trace: TraceEntry[];
}

export interface EvaluateResponseOk extends EvaluateResponseBase {
  status: "OK";
  hypothesis_set_active: ConditionId[];
  hypothesis_set_excluded: ConditionId[];
  posteriors: PosteriorEntry[];
  unknown: UnknownBlock;
  confidence: ConfidenceBlock;
  next_question: NextQuestion | null;
  deferred_questions: DeferredQuestion[];
  completeness: CompletenessBlock;
  escalation?: EscalationBlock; // VB-01, only when SHADOW_DANGEROUS_OOS posterior >= 0.10
}

export interface EvaluateResponseHalt extends EvaluateResponseBase {
  status: "HALT_RED_FLAG";
  halt: HaltBlock;
  // posteriors, unknown, confidence, next_question, completeness: absent by contract (§2.4)
}

export interface EvaluateResponseInsufficientData extends EvaluateResponseBase {
  status: "INSUFFICIENT_SAFETY_DATA";
  missing_safety_observations: string[];
  next_question: NextQuestion;
}

export interface EvaluateResponseInvalid {
  schema_version: string;
  status: "INVALID_INPUT";
  reason: string;
  detail?: unknown;
}

export type EvaluateResponse =
  | EvaluateResponseOk
  | EvaluateResponseHalt
  | EvaluateResponseInsufficientData
  | EvaluateResponseInvalid;
