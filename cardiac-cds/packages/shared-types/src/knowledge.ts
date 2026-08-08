import type {
  CareSetting,
  CitationType,
  ConditionClass,
  ConditionId,
  EvidenceGrade,
  EvidenceTier,
  Invasiveness,
  RedFlagId,
  VerificationStatus,
  Visibility,
} from "./enums.js";

/** §1.6 — the derivation an author must supply when a paper reports sens/spec. */
export interface DerivedFrom {
  sensitivity: number;
  specificity: number;
  n: number;
  prevalence_in_study: number;
}

/** §1.6 — one possible state of a feature, with its LR for the condition it's declared in. */
export interface FeatureState {
  value: string;
  lr: number;
  derived_from?: DerivedFrom;
  citation_id: string | null; // required non-null unless lr === 1.0
}

/** §1.6 — a single feature as it appears inside a condition file. */
export interface ConditionFeature {
  feature_id: string;
  tier: EvidenceTier;
  dependency_group: string | null;
  acquisition_cost: number; // 1-10
  prerequisite: string | null;
  invasiveness: Invasiveness;
  turnaround_minutes: number;
  states: FeatureState[];
  verification_status: VerificationStatus;
}

/** §1.5 — prior weight for one care setting. */
export interface PriorEntry {
  weight: number;
  citation_id: string;
  population: string;
  verification_status: VerificationStatus;
}

/** §1.3 — dependency group definition. */
export interface DependencyGroup {
  group_id: string;
  redundancy_lambda: number;
  rationale: string;
}

/** §1.4 — one profile entry used for fit score (§3.4). */
export interface ExpectedProfileEntry {
  feature_id: string;
  expected_state: string | string[];
  weight: number;
  hallmark: boolean;
}

export interface Provenance {
  authors: string[];
  clinical_reviewer: string | null;
  created: string; // ISO date
  last_reviewed: string | null;
  review_due: string | null;
}

/** §1.4 — the full condition knowledge file, mandatory fields only. */
export interface ConditionFile {
  schema_version: string;
  condition_id: ConditionId;
  display_name: string;
  class: ConditionClass;
  visibility: Visibility;
  enabled: boolean;
  priors: Partial<Record<CareSetting, PriorEntry>>;
  features: ConditionFeature[];
  expected_profile: ExpectedProfileEntry[];
  dependency_groups: DependencyGroup[];
  red_flag_links: RedFlagId[];
  mimics: ConditionId[];
  disposition_guidance: string;
  provenance: Provenance;
  verification_status: VerificationStatus;
}

/** §1.7 — one entry in citations.yaml. */
export interface Citation {
  type: CitationType;
  title: string;
  authors: string;
  year: number;
  doi?: string;
  pmid?: string;
  evidence_grade: EvidenceGrade;
  table_or_figure: string;
  extracted_by: string;
  extracted_on: string;
  checked_by: string | null;
  notes?: string;
}

export type CitationsFile = Record<string, Citation>;

/** features.registry.yaml — the canonical wording/tier/states for a feature_id. */
export interface FeatureRegistryEntry {
  feature_id: string;
  prompt: string;
  tier: EvidenceTier;
  dependency_group: string | null;
  state_values: string[];
}

export type FeatureRegistryFile = Record<string, FeatureRegistryEntry>;
