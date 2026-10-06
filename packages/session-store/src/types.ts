// packages/session-store/src/types.ts
/**
 * Session and evidence types per spec sec. 2 and Chat 2's session architecture.
 * Evidence and trace are append-only; derived state is recomputed by replay.
 */

import type { GateResult } from "@cds/safety-gate";
import type {
  ReportedDistribution,
  RankedQuestion,
  RescoredQuestion,
} from "@cds/engine";

export interface EvidenceEntry {
  id: string;
  featureId: string;
  value: string;
  rawValue?: number | string;
  source: "MEASURED" | "OBSERVED" | "PATIENT_REPORTED" | "CARER_REPORTED" | "RECORD";
  observedAt: string;
  observerConfidence: "HIGH" | "MEDIUM" | "LOW";
  turn: number;
  correctedAt?: string;
  corrects?: string;
}

export interface SessionMetadata {
  sessionId: string;
  createdAt: string;
  careSetting: string;
  patientAge: number;
  patientSex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
  patientPregnancy?: "PREGNANT" | "POSTPARTUM_6WK" | "NOT_PREGNANT" | "UNKNOWN" | "NOT_APPLICABLE";
}

/** A question the client can render: engine ranking plus pack wording. */
export interface AskableQuestion extends RankedQuestion {
  prompt: string;
  stateValues: string[];
}

/** A deferred question with its rescored impact plus pack wording. */
export interface PendingQuestion extends RescoredQuestion {
  prompt: string;
  stateValues: string[];
}

/** One row of the reported distribution: four candidates plus UNKNOWN. */
export interface DistributionEntry {
  id: string;
  probability: number;
}

/** Observations still missing before any posterior may be emitted. */
export interface MinimumSafetySet {
  complete: boolean;
  missing: string[];
}

/** A red-flag finding that has not been observed yet. */
export interface RedFlagFinding {
  featureId: string;
  prompt: string;
  stateValues: string[];
  tier: string;
  /**
   * False when the finding is derived by the server from a raw vital sign
   * (e.g. heart-rate category from VS_HEART_RATE). Those are supplied through
   * the vitals form, never answered directly.
   */
  answerable: boolean;
}

/** A red-flag rule that cannot be evaluated yet, and what it is waiting for. */
export interface RedFlagCheck {
  ruleId: string;
  displayName: string;
  missingFindings: RedFlagFinding[];
}

/**
 * One active (not retracted) piece of evidence, with the wording needed to
 * display and re-answer it. Vitals are not in the features registry, so their
 * wording is null: the client owns vital labels and units.
 */
export interface AnsweredEvidence {
  evidenceId: string;
  featureId: string;
  value: string;
  rawValue: number | string | null;
  turn: number;
  /** True for the minimum-safety-set observations (vitals, mental status). */
  isVital: boolean;
  prompt: string | null;
  stateValues: string[] | null;
  tier: string | null;
}

export interface HaltTrigger {
  findingId: string;
  requiredState: string;
  description: string;
  observedState: string | null;
  /** True when this trigger's required state was observed. */
  matched: boolean;
  /** The recorded readings this finding was derived from, so the client can offer to correct them. */
  sourceEvidence: Array<{ evidenceId: string; featureId: string }>;
}

export interface HaltRuleInfo {
  ruleId: string;
  displayName: string;
  clinicalRationale: string;
  haltMessage: string;
  triggers: HaltTrigger[];
}

/** Everything the HALT screen shows. Contains no probabilities. */
export interface HaltInfo {
  primaryRule: string;
  rules: HaltRuleInfo[];
}

export type TraceKind =
  | "EVIDENCE_ADDED"
  | "EVIDENCE_CORRECTED"
  | "QUESTION_DEFERRED"
  | "SESSION_HALTED"
  | "HALT_CLEARED";

export interface TraceCitation {
  /** An in-scope condition id, or "UNKNOWN" for the aggregated remainder. */
  hypothesisId: string;
  citationId: string;
}

/**
 * One persisted, append-only event. Never edited or reordered: a correction is
 * a new EVIDENCE_CORRECTED record that points at the entry it replaces.
 * before/after are null when no differential existed at that moment.
 */
export interface TraceRecord {
  seq: number;
  turn: number;
  at: string;
  kind: TraceKind;
  featureId: string | null;
  value: string | null;
  /** For EVIDENCE_CORRECTED: the value that was replaced. */
  previousValue: string | null;
  evidenceId: string | null;
  /** For EVIDENCE_CORRECTED: id of the evidence entry that was replaced. */
  corrects: string | null;
  before: DistributionEntry[] | null;
  after: DistributionEntry[] | null;
  citations: TraceCitation[];
  note: string | null;
}

export interface SessionState {
  metadata: SessionMetadata;
  halted: boolean;
  haltReason: string | null;
  haltRule: string | null;
  /** Present only while halted. */
  halt: HaltInfo | null;
  turn: number;
  evidenceLog: EvidenceEntry[]; // append-only, PERSISTED source of truth

  /** Active evidence with wording, recomputed from the log on every save. */
  answeredEvidence: AnsweredEvidence[];

  minimumSafetySet: MinimumSafetySet;

  /**
   * Four in-scope candidates + UNKNOWN, ranked by probability (highest
   * first). Shadow hypotheses never appear here or anywhere downstream. Null
   * before the minimum safety set is met, and null while halted.
   */
  distribution: ReportedDistribution | null;

  /** The most recent evidence event that produced a distribution. */
  lastMovement: TraceRecord | null;

  lastGateResult: GateResult | null;

  /** Rules waiting on findings, with wording. Empty while halted. */
  redFlagChecks: RedFlagCheck[];

  /** Ranked question with cost, EIG, tier gate, and pack wording. */
  nextQuestion: AskableQuestion | null;

  /** PERSISTED deferrals: plain featureId + turn. The rescored view is below. */
  deferredFeatureIds: Array<{ featureId: string; deferredAtTurn: number }>;

  /** Rescored deferred queue, recomputed on every inference pass. */
  pending: readonly PendingQuestion[];

  /** Persisted, append-only event trace. */
  trace: TraceRecord[];
}

export interface SubmitEvidenceRequest {
  featureId: string;
  value: string;
  rawValue?: number | string;
  source: "MEASURED" | "OBSERVED" | "PATIENT_REPORTED" | "CARER_REPORTED" | "RECORD";
  observedAt: string;
  observerConfidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface CorrectEvidenceRequest {
  evidenceId: string;
  featureId: string;
  value: string;
  rawValue?: number | string;
  source: "MEASURED" | "OBSERVED" | "PATIENT_REPORTED" | "CARER_REPORTED" | "RECORD";
  observedAt: string;
  observerConfidence: "HIGH" | "MEDIUM" | "LOW";
}