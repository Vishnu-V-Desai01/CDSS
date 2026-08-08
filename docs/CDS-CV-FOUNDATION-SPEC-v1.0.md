# CARDIOVASCULAR CDS — FOUNDATION SPECIFICATION
**Document ID:** CDS-CV-FOUNDATION
**Version:** 1.0 (Chat 0 design contract)
**Status:** BINDING. Chats 1–6 must not contradict this document. If a downstream chat needs to deviate, it raises an amendment against a section ID; it does not silently diverge.
**Scope of this document:** schema, contract, vocabulary, halt rules, shadow model. **No code. No implementation.**

---

## 0. PREAMBLE — SAFETY POSTURE (non-negotiable, applies to all six chats)

**0.1** This system is *decision support*. It never issues a disposition, never discharges, never "rules out". Every output is advisory to a qualified clinician who retains full responsibility.

**0.2** Prohibited output language, at every layer, including debug: `rule out`, `excluded`, `not PE`, `safe for discharge`, `benign`, `reassure`. Permitted framing: `lower probability`, `does not meet threshold for X`, `consider`, `escalate`.

**0.3** Every numeric value in this document (priors, likelihood ratios, thresholds) is a **default carrying `verification_status: unverified`**. They are drawn from the published literature cited but have not been checked against source tables for this project, and several are setting-dependent. The clinical lead must verify or replace each before any use on real patients. Downstream chats treat these as *slots with plausible defaults*, not as clinical truth. A knowledge file with any `verification_status: unverified` field must refuse to load in a production build.

**0.4** This is Software as a Medical Device under UK MDR / EU MDR / FDA SaMD framing. Regulatory classification, clinical validation and post-market surveillance are out of scope for Chats 1–6 but must not be designed against.

**0.5** Auditability outranks brevity. Nothing that influences a probability may be un-logged.

---

## 1. KNOWLEDGE FILE SCHEMA

### 1.1 Format and storage

- One file per condition. Filename: `<condition_id>.knowledge.yaml`.
- **YAML is the authoring format. JSON is the canonical runtime format.** YAML compiles to JSON at build time; the JSON is what the engine loads and what is hashed.
- All condition files for a release are bundled into a **knowledge pack** with a single semantic version and a content hash. Every engine response cites `knowledge_pack_version` and `knowledge_pack_hash`. A session may not span two packs.
- Files are validated against a JSON Schema at build time. Validation failure = build failure, not a runtime warning.

### 1.2 Likelihood representation — the decision

**Canonical stored value is the likelihood ratio (LR), a positive float.**

Rationale: the engine is a sequential log-odds updater. LRs are what it consumes. Sensitivity/specificity are what authors read off papers. Storing sens/spec and deriving LRs at runtime hides derivation errors; storing LRs and *requiring* the source sens/spec alongside makes the derivation auditable.

Rules:

1. Every state of every feature carries an explicit `lr`. There is no implicit LR.
2. If the source paper reports sensitivity/specificity, the author **must** also populate `derived_from: {sensitivity, specificity, n, prevalence_in_study}`. The build step recomputes `LR+ = sens / (1 − spec)` and `LR− = (1 − sens) / spec` and **fails the build if the stored `lr` differs by more than 5%**. This catches transcription errors.
3. The engine works internally in **natural log-odds**. Conversion is the engine's business, not the knowledge file's. Knowledge files never contain log values.
4. `lr: 1.0` means "this state carries no information for this condition" and must be stated explicitly. It is not the same as omitting the state, which is a schema error.
5. **Unknown / not-yet-asked is always LR = 1.0** and is applied by the engine, never stored.

**Clamping (engine-side, stated here so it is in the contract):**
- Any single applied log-LR is clamped to ±ln(20).
- Cumulative log-odds displacement from prior, per condition, is clamped to ±ln(1000).
- Clamp events are trace-logged with `clamp_applied: true`. Silent clamping is a defect.

### 1.3 Conditional independence — the honest handling

Naive Bayes assumes conditional independence. That assumption is false for clinical findings (pleuritic pain, sharp pain, and worse-on-inspiration are close to the same observation). Uncorrected, correlated features triple-count and produce false confidence.

Mechanism:

- Every feature declares a `dependency_group` (nullable).
- Within a dependency group, for a given condition, the engine applies the **single largest |log LR| at full weight**, and each subsequent member at weight **λ = 0.35** (configurable per group via `redundancy_lambda`, default 0.35).
- Ordering within the group for this purpose is by |log LR| descending, tie-broken by `feature_id` lexicographic ascending. Deterministic.
- The discount applied is trace-logged per feature.

This is a crude correction and is documented as such. It is preferable to pretending the problem does not exist.

### 1.4 Mandatory fields — every condition file

| Field | Type | Notes |
|---|---|---|
| `schema_version` | string | semver, must match pack |
| `condition_id` | string | UPPER_SNAKE, stable, never reused |
| `display_name` | string | clinician-facing |
| `class` | enum | `CANDIDATE` \| `SHADOW` \| `SHADOW_DANGEROUS` |
| `visibility` | enum | `REPORTED` \| `HIDDEN_IN_UNKNOWN` \| `HIDDEN_UNLESS_THRESHOLD` |
| `enabled` | bool | pack-level kill switch |
| `priors` | map | keyed by `care_setting` (§1.5) |
| `features` | list | §1.6 |
| `expected_profile` | list | drives fit score, §3.4 |
| `dependency_groups` | list | group definitions with `redundancy_lambda` |
| `red_flag_links` | list | red flag IDs this condition motivates |
| `mimics` | list | condition_ids commonly confused; documentation only, no engine effect |
| `disposition_guidance` | string | non-prescriptive prose, never auto-applied |
| `provenance` | object | §1.7 |
| `verification_status` | enum | `unverified` \| `clinician_verified` \| `locally_calibrated` |

No optional fields exist at the top level. Absent = build failure.

### 1.5 Priors

Priors are **unnormalised weights keyed by care setting**, not probabilities.

```yaml
priors:
  ED_UNDIFFERENTIATED_CHEST_PAIN:
    weight: 0.040
    citation_id: CIT-PE-PRIOR-01
    population: "Adults presenting to ED with non-traumatic chest pain and/or dyspnoea"
    verification_status: unverified
  PRIMARY_CARE_CHEST_PAIN:
    weight: 0.005
    citation_id: CIT-PE-PRIOR-02
    population: "Adults, general practice, chest pain as presenting complaint"
    verification_status: unverified
```

- Supported `care_setting` values: `ED_UNDIFFERENTIATED_CHEST_PAIN`, `PRIMARY_CARE_CHEST_PAIN`, `PREHOSPITAL`, `TELEHEALTH_TRIAGE`. The setting is a **required** input (§2.2); there is no default. A missing setting is a 400, not a fallback to ED.
- The engine normalises weights across the full hypothesis set at t₀. Normalisation is logged with the pre- and post-normalisation vectors.
- A condition with no weight for the requested setting is **excluded from that session** and this is reported in `hypothesis_set_active`. It is never silently given a nominal weight.

### 1.6 Feature objects

```yaml
- feature_id: PE_LEG_SWELLING_UNILATERAL
  prompt: "Is there unilateral leg swelling or calf tenderness?"
  tier: BEDSIDE
  dependency_group: DVT_SIGNS
  acquisition_cost: 1          # integer 1-10, see §3.2
  prerequisite: null           # feature_id that must be answered first, or null
  invasiveness: NONE           # NONE | MINOR | SIGNIFICANT
  turnaround_minutes: 2
  states:
    - value: PRESENT
      lr: 2.60
      derived_from: {sensitivity: 0.30, specificity: 0.88, n: 1121, prevalence_in_study: 0.23}
      citation_id: CIT-PE-WELLS-03
    - value: ABSENT
      lr: 0.80
      derived_from: {sensitivity: 0.30, specificity: 0.88, n: 1121, prevalence_in_study: 0.23}
      citation_id: CIT-PE-WELLS-03
    - value: INDETERMINATE
      lr: 1.00
      citation_id: null
  verification_status: unverified
```

Rules:
- `states` must be exhaustive and mutually exclusive. For binary findings that is exactly `PRESENT | ABSENT | INDETERMINATE`.
- Ordinal findings (e.g. `SPO2_ROOM_AIR`) declare ordered bands as states with non-overlapping, gap-free ranges. Overlap or gap = build failure.
- A feature may appear in multiple condition files. The `feature_id`, `prompt`, `tier`, `dependency_group` and `states[].value` set **must be byte-identical** across files. Only `lr`, `derived_from` and `citation_id` may differ. Build step enforces this; divergent prompts are a common and dangerous defect.
- Global feature definitions live in `features.registry.yaml`; condition files reference and supply LRs. The registry is the single source of truth for wording.

### 1.7 Citations

Citations are **not inline strings**. They are IDs resolving to a pack-level `citations.yaml`.

```yaml
CIT-PE-WELLS-03:
  type: PRIMARY_STUDY          # PRIMARY_STUDY | SYSTEMATIC_REVIEW | GUIDELINE | EXPERT_CONSENSUS | LOCAL_AUDIT
  title: "..."
  authors: "..."
  year: 2001
  doi: "10.xxxx/xxxxx"
  pmid: "..."
  evidence_grade: B            # A | B | C | D (see §3.7)
  table_or_figure: "Table 2, derivation cohort"
  extracted_by: "<initials>"
  extracted_on: "2026-08-07"
  checked_by: null             # must be non-null for clinician_verified
  notes: "Derivation cohort only; validation cohort figures differ, see CIT-PE-WELLS-04"
```

Rules:
- Every `lr` that is not exactly 1.0 requires a non-null `citation_id`. Build failure otherwise.
- Every prior requires a `citation_id`.
- `EXPERT_CONSENSUS` citations are permitted but are counted; a pack where >20% of non-unity LRs rest on expert consensus emits a build warning that must be explicitly acknowledged in the release record.
- `table_or_figure` is mandatory. "The paper" is not a citation.

### 1.8 Example — PE knowledge file skeleton

```yaml
schema_version: "1.0.0"
condition_id: PULMONARY_EMBOLISM
display_name: "Pulmonary embolism"
class: CANDIDATE
visibility: REPORTED
enabled: true
verification_status: unverified

priors:
  ED_UNDIFFERENTIATED_CHEST_PAIN:
    weight: 0.040
    citation_id: CIT-PE-PRIOR-01
    population: "Adults, ED, non-traumatic chest pain and/or dyspnoea"
    verification_status: unverified
  PRIMARY_CARE_CHEST_PAIN:
    weight: 0.005
    citation_id: CIT-PE-PRIOR-02
    population: "Adults, general practice, chest pain presenting complaint"
    verification_status: unverified

dependency_groups:
  - group_id: DVT_SIGNS
    redundancy_lambda: 0.35
    rationale: "Leg swelling, calf tenderness and unilateral warmth co-occur."
  - group_id: PLEURITIC_CLUSTER
    redundancy_lambda: 0.30
    rationale: "Pleuritic quality, worse-on-inspiration and splinting are near-synonymous."
  - group_id: OXYGENATION
    redundancy_lambda: 0.40
    rationale: "SpO2, respiratory rate and subjective dyspnoea are physiologically coupled."

features:
  # --- HISTORY ---
  - feature_id: HX_PREVIOUS_VTE
    tier: HISTORY
    dependency_group: null
    acquisition_cost: 1
    states:
      - {value: PRESENT, lr: 2.90, derived_from: {...}, citation_id: CIT-PE-RISK-01}
      - {value: ABSENT,  lr: 0.70, derived_from: {...}, citation_id: CIT-PE-RISK-01}
      - {value: INDETERMINATE, lr: 1.00, citation_id: null}

  - feature_id: HX_ACTIVE_MALIGNANCY
    tier: HISTORY
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 2.30, ...}, {value: ABSENT, lr: 0.85, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: HX_IMMOBILISATION_OR_SURGERY_4WK
    tier: HISTORY
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 2.60, ...}, {value: ABSENT, lr: 0.75, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: HX_OESTROGEN_THERAPY
    tier: HISTORY
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 1.60, ...}, {value: ABSENT, lr: 0.95, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: HX_PREGNANT_OR_POSTPARTUM_6WK
    tier: HISTORY
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 2.00, ...}, {value: ABSENT, lr: 0.98, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: SX_ONSET_SUDDEN_DYSPNOEA
    tier: HISTORY
    dependency_group: OXYGENATION
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 1.60, ...}, {value: ABSENT, lr: 0.70, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: SX_PLEURITIC_QUALITY
    tier: HISTORY
    dependency_group: PLEURITIC_CLUSTER
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 1.20, ...}, {value: ABSENT, lr: 0.85, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: SX_HAEMOPTYSIS
    tier: HISTORY
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 1.60, ...}, {value: ABSENT, lr: 0.95, ...}, {value: INDETERMINATE, lr: 1.00}]

  # --- BEDSIDE ---
  - feature_id: VS_HEART_RATE
    tier: BEDSIDE
    acquisition_cost: 1
    states:
      - {value: LT_60,      lr: 0.60, citation_id: CIT-PE-VS-01}
      - {value: 60_TO_99,   lr: 0.70, citation_id: CIT-PE-VS-01}
      - {value: 100_TO_119, lr: 1.80, citation_id: CIT-PE-VS-01}
      - {value: GTE_120,    lr: 2.40, citation_id: CIT-PE-VS-01}
      - {value: INDETERMINATE, lr: 1.00, citation_id: null}

  - feature_id: VS_SPO2_ROOM_AIR
    tier: BEDSIDE
    dependency_group: OXYGENATION
    acquisition_cost: 1
    states:
      - {value: GTE_95, lr: 0.60, citation_id: CIT-PE-VS-02}
      - {value: 90_TO_94, lr: 2.10, citation_id: CIT-PE-VS-02}
      - {value: LT_90, lr: 3.00, citation_id: CIT-PE-VS-02}   # also fires RF-05
      - {value: INDETERMINATE, lr: 1.00, citation_id: null}

  - feature_id: EX_UNILATERAL_LEG_SWELLING
    tier: BEDSIDE
    dependency_group: DVT_SIGNS
    acquisition_cost: 1
    states: [{value: PRESENT, lr: 2.60, ...}, {value: ABSENT, lr: 0.80, ...}, {value: INDETERMINATE, lr: 1.00}]

  # --- NEAR_BEDSIDE ---
  - feature_id: ECG_S1Q3T3
    tier: NEAR_BEDSIDE
    acquisition_cost: 3
    states: [{value: PRESENT, lr: 3.70, ...}, {value: ABSENT, lr: 0.90, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: ECG_SINUS_TACHYCARDIA
    tier: NEAR_BEDSIDE
    dependency_group: OXYGENATION
    acquisition_cost: 3
    states: [{value: PRESENT, lr: 1.50, ...}, {value: ABSENT, lr: 0.80, ...}, {value: INDETERMINATE, lr: 1.00}]

  - feature_id: LAB_DDIMER_HIGHSENS
    tier: NEAR_BEDSIDE
    acquisition_cost: 5
    turnaround_minutes: 45
    states:
      - {value: POSITIVE, lr: 1.70, ...}
      - {value: NEGATIVE, lr: 0.09, ...}   # the dominant negative-LR feature for PE
      - {value: INDETERMINATE, lr: 1.00}

  # --- IMAGING ---
  - feature_id: IMG_CTPA
    tier: IMAGING
    acquisition_cost: 9
    invasiveness: MINOR
    turnaround_minutes: 90
    states:
      - {value: POSITIVE, lr: 24.00, ...}
      - {value: NEGATIVE, lr: 0.05, ...}
      - {value: NONDIAGNOSTIC, lr: 1.00, citation_id: null}
      - {value: INDETERMINATE, lr: 1.00, citation_id: null}

expected_profile:
  - {feature_id: SX_ONSET_SUDDEN_DYSPNOEA, expected_state: PRESENT, weight: 3, hallmark: false}
  - {feature_id: VS_SPO2_ROOM_AIR, expected_state: [90_TO_94, LT_90], weight: 3, hallmark: false}
  - {feature_id: VS_HEART_RATE, expected_state: [100_TO_119, GTE_120], weight: 2, hallmark: false}
  - {feature_id: SX_PLEURITIC_QUALITY, expected_state: PRESENT, weight: 2, hallmark: false}
  - {feature_id: EX_UNILATERAL_LEG_SWELLING, expected_state: PRESENT, weight: 2, hallmark: false}
  - {feature_id: LAB_DDIMER_HIGHSENS, expected_state: POSITIVE, weight: 4, hallmark: true}

red_flag_links: [RF-01, RF-05, RF-06, RF-07, RF-09, RF-12]
mimics: [ACUTE_PERICARDITIS, SHADOW_ANXIETY_PANIC, SHADOW_DANGEROUS_OOS]
disposition_guidance: >
  PE cannot be excluded by clinical features alone. Where probability is
  non-trivial, formal risk stratification and definitive imaging pathways
  apply. This engine does not implement or substitute for those pathways.

provenance:
  authors: ["<name>"]
  clinical_reviewer: null
  created: "2026-08-07"
  last_reviewed: null
  review_due: null
```

Note the `...` placeholders: every one must be filled with a real `derived_from` and `citation_id` before the file is valid.

---

## 2. ENGINE API CONTRACT

### 2.1 Architectural decision — the core is a pure function

**The inference engine is a pure function of the evidence *set*.** `evaluate(patient, care_setting, evidence_set, options) → result`. It has no memory and no dependence on the order in which evidence arrived.

The **session** is a thin wrapper that stores an ordered, append-only evidence log and calls `evaluate` with the whole accumulated set on every turn.

This makes §2.6's order-independence constraint true *by construction* rather than by test. Downstream chats must not introduce incremental in-place updating as an optimisation; it reintroduces order-dependence through clamping and dependency-group interactions.

### 2.2 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/evaluate` | Stateless. Full evidence set in, full result out. The real engine. |
| `POST` | `/v1/sessions` | Create session. Returns `session_id`, initial result. |
| `POST` | `/v1/sessions/{id}/evidence` | Append 1..n evidence items. Returns full result. |
| `GET` | `/v1/sessions/{id}` | Current result, no mutation. |
| `GET` | `/v1/sessions/{id}/trace` | Full trace. |
| `POST` | `/v1/sessions/{id}/report` | Final clinician-facing report. |

Sessions are sugar. `/v1/evaluate` is the contract that matters and is what Chats 1–6 test against.

### 2.3 Input JSON

```json
{
  "schema_version": "1.0.0",
  "care_setting": "ED_UNDIFFERENTIATED_CHEST_PAIN",
  "patient": {
    "age_years": 34,
    "sex_at_birth": "FEMALE",
    "pregnancy_status": "PREGNANT",
    "known_baseline_sbp": 118
  },
  "presenting_complaint": ["CHEST_PAIN", "DYSPNOEA"],
  "evidence": [
    {
      "feature_id": "VS_SPO2_ROOM_AIR",
      "value": "90_TO_94",
      "raw_value": 93,
      "source": "MEASURED",
      "observed_at": "2026-08-07T09:14:02Z",
      "observer_confidence": "HIGH"
    },
    {
      "feature_id": "HX_OESTROGEN_THERAPY",
      "value": "PRESENT",
      "source": "PATIENT_REPORTED",
      "observed_at": "2026-08-07T09:12:40Z",
      "observer_confidence": "MEDIUM"
    }
  ],
  "options": {
    "allowed_tiers": ["HISTORY", "BEDSIDE", "NEAR_BEDSIDE"],
    "max_questions_returned": 1,
    "return_trace": true,
    "return_shadow_composition": false
  }
}
```

Field rules:
- `care_setting` — **required**, no default.
- `patient.age_years`, `sex_at_birth` — **required** (some priors and LRs are conditioned on them).
- `pregnancy_status` ∈ `PREGNANT | POSTPARTUM_6WK | NOT_PREGNANT | UNKNOWN | NOT_APPLICABLE`. `UNKNOWN` in a person of childbearing potential generates a deferred question at high priority, never an assumption.
- `evidence[].source` ∈ `MEASURED | OBSERVED | PATIENT_REPORTED | CARER_REPORTED | RECORD | INFERRED`. `INFERRED` is rejected — the engine does not accept second-hand inference as evidence.
- `evidence[].observer_confidence` ∈ `HIGH | MEDIUM | LOW`. `LOW` applies a shrinkage factor of 0.5 to the applied log-LR, trace-logged. `MEDIUM` = 0.8. `HIGH` = 1.0.
- `raw_value` optional, for audit; the engine bands it and **verifies the supplied `value` matches the band**, returning 422 on mismatch rather than silently preferring one.
- `options.return_shadow_composition` — only honoured for callers holding the `DEBUG_SHADOW` scope. Never available to the clinician-facing UI.

**Duplicate evidence:** if the same `feature_id` appears twice, the item with the later `observed_at` wins. Both are retained in the trace and an `evidence_conflict` entry is emitted. Identical `observed_at` → lexicographic tie-break on `value`, and a `WARN` level trace entry. No ambiguity.

### 2.4 Output JSON

```json
{
  "schema_version": "1.0.0",
  "engine_version": "1.0.0",
  "knowledge_pack_version": "2026.08.1",
  "knowledge_pack_hash": "sha256:...",
  "evaluated_at": "2026-08-07T09:14:03Z",

  "status": "OK",

  "safety": {
    "red_flags_fired": [],
    "red_flags_unevaluable": ["RF-04"],
    "minimum_safety_set_complete": true,
    "missing_safety_observations": []
  },

  "hypothesis_set_active": [
    "PULMONARY_EMBOLISM","UNSTABLE_ANGINA","CONGESTIVE_HEART_FAILURE",
    "ACUTE_PERICARDITIS","SHADOW_ANXIETY_PANIC","SHADOW_MUSCULOSKELETAL",
    "SHADOW_GORD","SHADOW_DANGEROUS_OOS","SHADOW_OTHER"
  ],
  "hypothesis_set_excluded": [],

  "posteriors": [
    {
      "condition_id": "PULMONARY_EMBOLISM",
      "probability": 0.2140,
      "log_odds": -1.3010,
      "prior_probability": 0.0400,
      "log_odds_delta": 1.7800,
      "fit_score": 0.62,
      "top_contributors": [
        {"feature_id": "VS_SPO2_ROOM_AIR", "value": "90_TO_94", "log_lr_applied": 0.742, "direction": "TOWARD"},
        {"feature_id": "HX_OESTROGEN_THERAPY", "value": "PRESENT", "log_lr_applied": 0.376, "direction": "TOWARD"}
      ]
    }
  ],

  "unknown": {
    "probability": 0.5120,
    "composition_disclosed": false,
    "interpretation": "Residual probability mass not attributable to the four modelled acute conditions."
  },

  "confidence": {
    "max_fit_score": 0.62,
    "leader_margin": 0.081,
    "entropy_bits": 2.41,
    "assessment": "INDETERMINATE"
  },

  "next_question": {
    "feature_id": "EX_UNILATERAL_LEG_SWELLING",
    "prompt": "Is there unilateral leg swelling or calf tenderness?",
    "tier": "BEDSIDE",
    "expected_information_gain_bits": 0.184,
    "acquisition_cost": 1,
    "why": "Currently the highest-yield discriminator between PULMONARY_EMBOLISM and the residual."
  },

  "deferred_questions": [
    {"feature_id": "IMG_CTPA", "reason_code": "TIER_NOT_ALLOWED", "tier": "IMAGING"},
    {"feature_id": "LAB_DDIMER_HIGHSENS", "reason_code": "PREREQUISITE_UNMET", "prerequisite": "EX_UNILATERAL_LEG_SWELLING"}
  ],

  "completeness": {
    "features_in_pack": 84,
    "features_answered": 9,
    "coverage_by_tier": {"HISTORY": 0.31, "BEDSIDE": 0.55, "NEAR_BEDSIDE": 0.10, "IMAGING": 0.00},
    "unanswered_high_value": ["EX_UNILATERAL_LEG_SWELLING", "SX_PLEURITIC_QUALITY"],
    "blocking_gaps": []
  },

  "trace": [ /* §3.5 */ ]
}
```

**`status` enum — exhaustive:**

| Value | Meaning | Posteriors present? |
|---|---|---|
| `OK` | Normal inference | Yes |
| `HALT_RED_FLAG` | §4 rule fired | **No** — key omitted entirely |
| `INSUFFICIENT_SAFETY_DATA` | Minimum safety set incomplete (§4.2) | **No** |
| `INVALID_INPUT` | 4xx-class content error | No |

There is no fifth state. `posteriors` is either fully present or the key is absent; it is never present-but-empty, never zero-filled.

### 2.5 Numeric conventions

- Probabilities: float, 4 decimal places, must sum to 1.0000 ± 1e-6 across `posteriors` + `unknown`.
- No reported probability may be 0.0000 or 1.0000. Floor 0.0001, ceiling 0.9999. Certainty is not expressible.
- `log_odds` in natural log, 4 dp.
- Rounding: half-away-from-zero, applied once at serialisation. Internal maths is full precision.

### 2.6 Constraints (testable, and Chats 1–6 must implement tests for each)

**C1 — Order independence.** For any evidence set E and any permutations π₁, π₂: `evaluate(π₁(E))` and `evaluate(π₂(E))` are byte-identical except `evaluated_at`. Includes `trace` ordering, which is canonicalised by sort key, not arrival order.

**C2 — Completeness.** Every active hypothesis appears in `posteriors` on every response. No pruning, no top-N truncation, no threshold-based hiding. A condition at 0.0001 is still listed.

**C3 — Determinism.** Same input + same pack + same engine version → same output. No randomness anywhere, including tie-breaks (§3.3). No wall-clock dependence except `evaluated_at`.

**C4 — Monotonic trace.** The trace is append-only within a session. Entries are never edited or removed. Corrections are new entries.

**C5 — No silent defaults.** Any value the engine supplies that the caller did not (normalisation, clamping, shrinkage, redundancy discount, banding) generates a trace entry.

**C6 — Halt precedence.** Red flag evaluation completes before any Bayesian computation. If any rule fires, no posterior is computed at all — not computed-then-suppressed. Verified by trace absence of `BELIEF_UPDATE` entries.

**C7 — Idempotent halt.** Once a session is `HALT_RED_FLAG`, all subsequent calls to that session return the identical halt payload. New evidence is stored in the trace and ignored for inference.

**C8 — Pack immutability within session.** A session pins `knowledge_pack_hash` at creation. A pack change mid-session returns 409.

---

## 3. GLOSSARY & DEFINITIONS

### 3.1 Evidence tiers

Four tiers. The brief specified three; `HISTORY` is separated from `BEDSIDE` because history requires no equipment, no consent and no patient exposure, and the question-selection cost model needs to reflect that.

| Tier | Definition | Test | Examples |
|---|---|---|---|
| `HISTORY` | Obtainable by asking. No equipment, no touching the patient. | Could be obtained over the phone. | Prior VTE, pain quality, onset, medications |
| `BEDSIDE` | Obtainable within arm's reach in under ~2 minutes with equipment normally on the person or in the room. No lab, no radiology, no consumables beyond routine. | Available at first contact by a single clinician. | HR, BP both arms, RR, SpO2, temperature, JVP, auscultation, palpation for reproducibility, peripheral oedema, calf exam, pulses |
| `NEAR_BEDSIDE` | Available in the clinical area, typically within 60 minutes, requiring a device, a consumable or another person. | Does not require leaving the department. | 12-lead ECG, POCUS, VBG/ABG, point-of-care troponin, point-of-care D-dimer, CXR |
| `IMAGING` | Requires scheduling, transport, radiation, contrast or a specialist operator. | Patient leaves the bedside, or a specialist is summoned. | CTPA, V/Q, formal echocardiography, coronary angiography, serial lab troponin |

Boundary rulings (binding, to stop six chats litigating them):
- **12-lead ECG is `NEAR_BEDSIDE`**, not bedside. It needs a machine, a second pair of hands in practice, and interpretation.
- **POCUS is `NEAR_BEDSIDE`** regardless of operator proximity, because it is operator-dependent and not universally available.
- **CXR is `NEAR_BEDSIDE`**, not `IMAGING`, when portable; the pack does not model portable/departmental separately.
- **Inter-arm BP is `BEDSIDE`** and is a distinct feature from single-arm BP.

`options.allowed_tiers` gates *question selection only*. Evidence submitted from a disallowed tier is still ingested and used — the engine never discards real clinical data because of a UI setting.

### 3.2 Acquisition cost

Integer 1–10, ordinal, used only for deterministic tie-breaking and for the cost-adjusted question ranking. Not a currency. Anchors: 1 = a question; 3 = ECG; 5 = point-of-care blood test; 7 = portable CXR; 9 = CT; 10 = invasive.

### 3.3 Halt condition vs deferred question

**Halt condition.** A deterministic rule over the raw evidence set, evaluated *before* inference, that terminates the diagnostic process. Properties: no probability is computed; no differential is emitted; the session is locked; the output is an escalation instruction only. Halting is not a diagnosis and not a probability statement — it is a statement that the situation exceeds the competence of a differential-generating tool. See §4.

**Deferred question.** A question the engine wants answered but cannot ask now. It is parked in `deferred_questions` with a machine-readable `reason_code` and **is never silently dropped**. Exhaustive reason codes:

| Code | Meaning |
|---|---|
| `TIER_NOT_ALLOWED` | Tier excluded by `options.allowed_tiers` |
| `PREREQUISITE_UNMET` | Declared `prerequisite` feature not yet answered |
| `ALREADY_ANSWERED` | Evidence already present |
| `NO_EXPECTED_YIELD` | Expected information gain below 0.01 bits |
| `DECISION_INSENSITIVE` | Both answers leave the ranking and all threshold crossings unchanged |
| `CONTRAINDICATED` | Patient attribute blocks it (e.g. contrast allergy, pregnancy) |
| `COST_EXCEEDS_BUDGET` | `acquisition_cost` above session budget |

Deferred is reversible; halt is not.

**Question selection, deterministically.** Rank candidate features by expected information gain (expected reduction in Shannon entropy over the *full nine-hypothesis* set, shadows included). Tie-break in strict order: (1) lowest tier ordinal, (2) lowest `acquisition_cost`, (3) lowest `turnaround_minutes`, (4) `feature_id` lexicographic ascending. No randomness. Two engines given the same state ask the same question.

### 3.4 Fit score

**Fit score answers a different question from posterior probability, and its existence is the main defence against the system's worst failure mode.**

Posterior probability is *relative*: it is a beauty contest among the hypotheses in the set. If the patient has a condition nobody modelled, one of the four candidates still wins, and it wins with a confident-looking number. Fit score is *absolute*: how well does this evidence actually match what this condition looks like?

Definition. For condition C with `expected_profile` P:

- Let `concordant` = Σ weights of profile entries where the observed state is in `expected_state`.
- Let `discordant` = Σ weights of profile entries where the state is observed and is *not* in `expected_state`.
- Let `observed_weight` = Σ weights of profile entries with any non-`INDETERMINATE` observation.
- Let `hallmark_penalty` = 0.5 for each profile entry with `hallmark: true` that is observed and discordant, multiplicatively applied.

```
fit_raw = (concordant − discordant) / observed_weight
fit_score = clamp(fit_raw, 0, 1) × Π(hallmark_penalty)
```

Reported to 2 dp. If `observed_weight` is less than 30% of total profile weight, `fit_score` is reported as `null` with `fit_status: "INSUFFICIENT_OBSERVATIONS"` — never as a low number, because unobserved is not the same as contradicted.

**Interaction with reporting.** If `max_fit_score` across all four candidates is below **0.40**, the engine sets `confidence.assessment: "POOR_FIT_ALL_CANDIDATES"` and the report leads with the statement that the presentation does not match any modelled condition well, *regardless of what the posterior ranking says*. A high posterior on a poorly fitting condition is a defect signal, not a diagnosis.

`confidence.assessment` enum, evaluated top-down, first match wins:
1. `POOR_FIT_ALL_CANDIDATES` — max fit < 0.40
2. `INDETERMINATE` — leader margin < 0.10 or `unknown.probability` > 0.50
3. `LEANING` — leader margin ≥ 0.10 and max fit ≥ 0.40
4. `CONVERGING` — leader probability ≥ 0.50, margin ≥ 0.25, max fit ≥ 0.60

There is no state above `CONVERGING`. The engine never expresses diagnostic certainty.

### 3.5 Trace entry

One entry per discrete engine action. Every field mandatory; unused fields are `null`, not absent.

```json
{
  "seq": 47,
  "session_id": "…",
  "timestamp": "2026-08-07T09:14:03.117Z",
  "event_type": "BELIEF_UPDATE",
  "engine_version": "1.0.0",
  "knowledge_pack_hash": "sha256:…",
  "feature_id": "VS_SPO2_ROOM_AIR",
  "value": "90_TO_94",
  "source": "MEASURED",
  "observer_confidence": "HIGH",
  "condition_id": "PULMONARY_EMBOLISM",
  "lr_raw": 2.10,
  "log_lr_raw": 0.7419,
  "adjustments": [
    {"type": "REDUNDANCY_DISCOUNT", "group_id": "OXYGENATION", "factor": 0.35, "reason": "…"},
    {"type": "CONFIDENCE_SHRINKAGE", "factor": 1.00, "reason": "…"}
  ],
  "log_lr_applied": 0.2597,
  "clamp_applied": false,
  "log_odds_before": -3.1781,
  "log_odds_after": -2.9184,
  "citation_id": "CIT-PE-VS-02",
  "rule_id": null,
  "severity": "INFO",
  "note": null
}
```

`event_type` enum, exhaustive: `SESSION_CREATED`, `EVIDENCE_RECEIVED`, `EVIDENCE_CONFLICT`, `RED_FLAG_EVALUATED`, `RED_FLAG_FIRED`, `RED_FLAG_UNEVALUABLE`, `PRIOR_NORMALISED`, `BELIEF_UPDATE`, `FIT_SCORE_COMPUTED`, `QUESTION_SELECTED`, `QUESTION_DEFERRED`, `SHADOW_AGGREGATED`, `SHADOW_VEIL_BROKEN`, `HALT`, `REPORT_EMITTED`.

`severity` ∈ `INFO | WARN | ERROR | SAFETY`. All `SAFETY` entries are additionally written to an immutable audit sink.

Canonical trace sort key (for C1): `(feature_id, condition_id, event_type, seq)`. `seq` reflects arrival and is preserved for audit but does not affect the canonicalised comparison.

### 3.6 Other terms

- **Hypothesis set** — the nine internal conditions. Fixed per session at creation.
- **Candidate** — one of the four reported conditions.
- **Shadow** — an internal hypothesis absorbing probability mass, hidden inside UNKNOWN. §5.
- **UNKNOWN** — the reported sum of all shadow posteriors. Not a condition. Not a diagnosis of exclusion.
- **Veil** — the rule that shadow composition is not disclosed. **Veil break** — the single carve-out at §5.5.
- **Minimum safety set** — the observations required before any posterior is emitted. §4.2.
- **Leader margin** — probability of highest-ranked candidate minus second-highest.
- **Blocking gap** — an unanswered feature whose absence makes a red flag unevaluable.

### 3.7 Evidence grades

`A` — systematic review/meta-analysis of consistent primary studies in a comparable population. `B` — single good primary study, or SR with heterogeneity. `C` — small, indirect, or population-mismatched study. `D` — expert consensus or local audit. Grade is recorded but does **not** algorithmically modify LRs in v1.0; downgrading by grade is a proposed v1.1 amendment, deliberately deferred so the effect of grade is not silently baked in.

---

## 4. RED FLAG LIST — HALT CONDITIONS

### 4.1 Semantics

- Evaluated on every call, before inference, over the raw evidence set, in ascending rule ID order.
- **All firing rules are reported.** The lowest-numbered is `primary_rule`. There is no "most severe" heuristic — that would be a judgement, and halts do not make judgements.
- A rule whose inputs are absent **does not fire** and is listed in `safety.red_flags_unevaluable`. Missing data never triggers a halt and never suppresses one.
- Firing produces `status: "HALT_RED_FLAG"`, the `posteriors` key **absent**, session locked.
- **No override.** There is no unlock endpoint. A clinician who disagrees starts a new session; the prior halt is carried as sticky context in that session's trace and is disclosed in the new session's output. This is deliberate: an override button becomes the default click.
- All thresholds below are for **non-pregnant adults ≥18**. Paediatric and obstetric physiology is **out of scope for v1.0**; `age_years < 18` returns `INVALID_INPUT` with `reason: OUT_OF_SCOPE_POPULATION`. Pregnancy modifiers are noted per rule.

### 4.2 Minimum safety set (gate, not a halt)

No posterior is emitted until all of the following are present: heart rate, respiratory rate, systolic and diastolic BP, SpO2, temperature, and a mental-status observation (alert / not alert).

Until complete: `status: "INSUFFICIENT_SAFETY_DATA"`, `posteriors` key absent, `missing_safety_observations` populated, and `next_question` returns the missing observations in fixed order (SpO2, BP, HR, RR, mental status, temperature). The engine will not speculate about a chest pain patient whose vital signs nobody has taken.

### 4.3 The list

| ID | Name | Trigger rule | Inputs |
|---|---|---|---|
| **RF-01** | Hypotension | SBP < 90 mmHg **OR** MAP < 65 mmHg **OR** (SBP drop ≥ 40 from `known_baseline_sbp`, where baseline supplied) | `VS_SBP`, `VS_DBP`, `patient.known_baseline_sbp` |
| **RF-02** | Syncope or near-syncope | Syncope or near-syncope reported in the current episode, with chest pain **or** dyspnoea | `SX_SYNCOPE_THIS_EPISODE` |
| **RF-03** | Tearing / migrating pain | Pain described as tearing, ripping or migrating **OR** abrupt onset reaching maximum intensity within 60 seconds | `SX_PAIN_QUALITY_TEARING`, `SX_ONSET_TO_PEAK_LT_60S` |
| **RF-04** | Inter-arm BP differential | Systolic differential ≥ 20 mmHg on simultaneous or sequential bilateral measurement | `VS_SBP_LEFT`, `VS_SBP_RIGHT` |
| **RF-05** | Hypoxaemia | SpO2 < 90% on room air **OR** SpO2 < 92% with a new supplemental oxygen requirement **OR** any new supplemental oxygen requirement in a patient not previously on oxygen | `VS_SPO2_ROOM_AIR`, `VS_O2_REQUIREMENT_NEW` |
| **RF-06** | Extreme heart rate | HR > 130 **OR** HR < 40 **OR** any HR with documented haemodynamic compromise | `VS_HEART_RATE` |
| **RF-07** | Respiratory distress | RR > 30 **OR** RR < 8 **OR** accessory muscle use **OR** unable to speak in full sentences | `VS_RESP_RATE`, `EX_ACCESSORY_MUSCLES`, `EX_SPEAKS_FULL_SENTENCES` |
| **RF-08** | Altered mental status | Any state other than alert and orientated, new for this patient | `EX_MENTAL_STATUS` |
| **RF-09** | Hypoperfusion | Capillary refill > 3 s **OR** mottled skin **OR** cold clammy peripheries **OR** anuria/oliguria reported | `EX_CAP_REFILL`, `EX_SKIN_MOTTLING`, `EX_PERIPHERAL_PERFUSION` |
| **RF-10** | Ischaemic ECG or positive troponin | ST elevation ≥ 1 mm in ≥2 contiguous leads **OR** new ST depression ≥ 0.5 mm **OR** new LBBB **OR** troponin above the assay's 99th centile URL | `ECG_ST_ELEVATION`, `ECG_ST_DEPRESSION`, `ECG_NEW_LBBB`, `LAB_TROPONIN` |
| **RF-11** | Tension physiology | Tracheal deviation **OR** (unilateral absent breath sounds **AND** (RF-01 **OR** RF-06 conditions met)) | `EX_TRACHEAL_DEVIATION`, `EX_UNILATERAL_ABSENT_BREATH_SOUNDS` |
| **RF-12** | Haemoptysis with hypoxaemia | Haemoptysis present **AND** SpO2 < 94% on room air | `SX_HAEMOPTYSIS`, `VS_SPO2_ROOM_AIR` |
| **RF-13** | Neurological deficit with chest pain | Any new focal neurological deficit concurrent with chest pain | `EX_FOCAL_NEURO_DEFICIT` |
| **RF-14** | Pulse deficit | Absent, unequal or asymmetric major pulses | `EX_PULSE_ASYMMETRY` |
| **RF-15** | Tamponade physiology | Pulsus paradoxus > 12 mmHg **OR** (raised JVP **AND** muffled heart sounds **AND** RF-01 conditions met) **OR** POCUS pericardial effusion with RV collapse | `EX_PULSUS_PARADOXUS`, `EX_JVP`, `EX_HEART_SOUNDS_MUFFLED`, `POCUS_PERICARDIAL_EFFUSION` |
| **RF-16** | Sustained or worsening pain despite therapy | Ongoing chest pain unchanged or worse ≥ 20 minutes after initial treatment, at rest | `SX_PAIN_ONGOING_AT_REST_20MIN` |

**Pregnancy modifiers.** Where `pregnancy_status ∈ {PREGNANT, POSTPARTUM_6WK}`: RF-01 SBP threshold rises to < 100 mmHg; RF-06 upper HR threshold rises to > 140; RF-05 is unchanged. These are the only modifiers in v1.0 and each is trace-logged as `MODIFIER_APPLIED`.

**Known-COPD modifier.** Deliberately **not** implemented. A stated history of COPD does not raise the RF-05 threshold, because that assumption kills people whose hypoxaemia this time is a PE. If the clinician judges the SpO2 to be at baseline, they act on that judgement outside the tool.

### 4.4 Halt output

```json
{
  "schema_version": "1.0.0",
  "engine_version": "1.0.0",
  "knowledge_pack_version": "2026.08.1",
  "status": "HALT_RED_FLAG",
  "halt": {
    "primary_rule": "RF-01",
    "all_fired_rules": [
      {
        "rule_id": "RF-01",
        "name": "Hypotension",
        "triggering_observations": [
          {"feature_id": "VS_SBP", "value": 84, "threshold": "< 90 mmHg", "source": "MEASURED",
           "observed_at": "2026-08-07T09:15:11Z"}
        ]
      }
    ],
    "action": "ESCALATE_IMMEDIATELY",
    "message": "Halt condition met: hypotension (systolic 84 mmHg). This tool does not generate a differential in the presence of haemodynamic instability. Escalate to senior clinical review now and manage per local emergency protocol.",
    "differential_suppressed": true,
    "session_locked": true,
    "override_available": false
  },
  "safety": {
    "red_flags_fired": ["RF-01"],
    "red_flags_unevaluable": ["RF-04", "RF-15"],
    "minimum_safety_set_complete": true
  },
  "trace": [ /* … includes RED_FLAG_FIRED and HALT, and zero BELIEF_UPDATE entries … */ ]
}
```

The `posteriors`, `unknown`, `confidence`, `next_question` and `completeness` keys are **absent**. Consuming clients must treat their absence as the contract, not render an empty state.

The `message` names the finding and the threshold. It does not name a suspected condition. Saying "possible aortic dissection" at a halt would be the tool making the diagnosis it just declared itself unfit to make.

---

## 5. SHADOW CONDITIONS SPECIFICATION

### 5.1 Why shadows exist

A four-hypothesis model over chest pain is a closed-world fallacy. Most chest pain in most settings is none of PE, UA, CHF or pericarditis. If those four are the only hypotheses, normalisation forces their posteriors to sum to 1, and every patient gets a confident-looking cardiac differential. The shadows are the mass sink that makes the reported numbers mean something.

Shadows are **full first-class hypotheses**: real priors, real likelihoods, real citations, updated identically to candidates. They are hidden at the reporting layer only.

### 5.2 The shadow set

Five, not four. **`SHADOW_OTHER` is an addition to the brief and requires the clinical lead's sign-off.** Without it, the four specified shadows plus four candidates carry roughly 0.72 of the ED prior mass, and normalisation inflates every posterior by ~1.4×. `SHADOW_OTHER` absorbs the genuinely unmodelled remainder (pneumonia, costochondritis variants, herpes zoster, biliary and pancreatic pain, cocaine-associated chest pain, sickle crisis, malignancy, functional disorders, and the long tail).

| ID | Class | Visibility |
|---|---|---|
| `SHADOW_ANXIETY_PANIC` | SHADOW | HIDDEN_IN_UNKNOWN |
| `SHADOW_MUSCULOSKELETAL` | SHADOW | HIDDEN_IN_UNKNOWN |
| `SHADOW_GORD` | SHADOW | HIDDEN_IN_UNKNOWN |
| `SHADOW_DANGEROUS_OOS` | SHADOW_DANGEROUS | HIDDEN_UNLESS_THRESHOLD |
| `SHADOW_OTHER` | SHADOW | HIDDEN_IN_UNKNOWN |

### 5.3 Priors — default weights

All `verification_status: unverified`. Sources are named for the clinical lead to check; figures are indicative and setting-dependent.

| Hypothesis | ED chest pain | Primary care chest pain | Source to verify |
|---|---|---|---|
| PULMONARY_EMBOLISM | 0.040 | 0.005 | ED chest pain cohort studies; primary care PE incidence |
| UNSTABLE_ANGINA | 0.090 | 0.020 | ACS prevalence in ED chest pain (ACS overall ~0.15–0.20; UA subset) |
| CONGESTIVE_HEART_FAILURE | 0.060 | 0.020 | HF prevalence in ED dyspnoea/chest pain |
| ACUTE_PERICARDITIS | 0.015 | 0.005 | Pericarditis ~0.1–0.2% of ED chest pain; higher in young adults |
| SHADOW_ANXIETY_PANIC | 0.150 | 0.100 | Fleet et al. 1996 (panic disorder in ED chest pain, ~25% of non-cardiac); Bösner/Haasenritter primary care series (psychogenic ~9–11%) |
| SHADOW_MUSCULOSKELETAL | 0.200 | 0.420 | Bösner et al. 2009/2010 (chest wall syndrome ~46% in primary care); Verdon et al. 2008 |
| SHADOW_GORD | 0.110 | 0.130 | Primary care GI causes ~13%; ED non-cardiac chest pain GORD fraction |
| SHADOW_DANGEROUS_OOS | 0.020 | 0.002 | Pneumothorax ~1% ED chest pain; dissection ~0.03–0.1%; tension PTX rarer |
| SHADOW_OTHER | 0.315 | 0.298 | Residual by subtraction; documented as such, not as a measured quantity |

Weights sum to 1.000 per setting by construction. `SHADOW_OTHER` is explicitly a residual and its `citation_id` is of type `EXPERT_CONSENSUS` with a note recording that it is derived by subtraction.

### 5.4 Key likelihoods

Same schema as candidates. The values below are the discriminating ones; each shadow's full file follows §1.

**`SHADOW_ANXIETY_PANIC`** — dependency group `AUTONOMIC_CLUSTER` (λ 0.30)

| Feature | State | LR | Note |
|---|---|---|---|
| `VS_SPO2_ROOM_AIR` | GTE_95 | 1.35 | Normal saturation is *weakly* supportive. It is not a discriminator against PE. |
| `VS_SPO2_ROOM_AIR` | LT_90 | 0.15 | |
| `HX_PRIOR_PANIC_DIAGNOSIS` | PRESENT | 3.40 | |
| `SX_PARAESTHESIAE_PERIORAL_OR_DIGITAL` | PRESENT | 3.00 | AUTONOMIC_CLUSTER |
| `SX_FEAR_OF_DYING_OR_LOSING_CONTROL` | PRESENT | 2.60 | AUTONOMIC_CLUSTER |
| `SX_IDENTIFIABLE_PSYCHOLOGICAL_TRIGGER` | PRESENT | 2.20 | |
| `SX_SYMPTOMS_PEAK_WITHIN_10MIN_THEN_EASE` | PRESENT | 2.80 | |
| `SCR_GAD2_POSITIVE` | PRESENT | 2.00 | |
| `HX_PREVIOUS_VTE` | PRESENT | 0.60 | |
| `EX_UNILATERAL_LEG_SWELLING` | PRESENT | 0.30 | |

**Constraint (binding, §5.6):** no combination of anxiety-supporting features may reduce `PULMONARY_EMBOLISM` below its escalation threshold. Panic and PE share dyspnoea, tachycardia, chest pain and a sense of doom. The single most reliably fatal error in this clinical space is labelling a young woman's PE as panic. The likelihoods above are deliberately modest for exactly this reason, and the LR of 1.35 for a normal SpO2 is intentionally weak.

**`SHADOW_MUSCULOSKELETAL`** — dependency group `CHEST_WALL_CLUSTER` (λ 0.30)

| Feature | State | LR | Note |
|---|---|---|---|
| `EX_PAIN_REPRODUCIBLE_ON_PALPATION` | PRESENT | 3.20 | CHEST_WALL_CLUSTER |
| `SX_PAIN_POSITIONAL` | PRESENT | 2.40 | CHEST_WALL_CLUSTER |
| `SX_PAIN_WELL_LOCALISED_POINTABLE` | PRESENT | 2.30 | CHEST_WALL_CLUSTER |
| `HX_RECENT_UNACCUSTOMED_EXERTION_OR_MINOR_TRAUMA` | PRESENT | 2.90 | |
| `SX_PLEURITIC_QUALITY` | PRESENT | 1.30 | **Weak.** Pleuritic pain is shared with PE and pericarditis and must not be treated as MSK-specific. |
| `SX_PAIN_DURATION_DAYS_INTERMITTENT` | PRESENT | 2.00 | |
| `VS_SPO2_ROOM_AIR` | LT_90 | 0.10 | |
| `SX_ONSET_SUDDEN_DYSPNOEA` | PRESENT | 0.35 | |

**Constraint:** `EX_PAIN_REPRODUCIBLE_ON_PALPATION = PRESENT` carries LR 0.30 for UA but only **0.85 for PE**. Reproducible chest wall tenderness is common in PE and does not argue meaningfully against it. Any downstream chat that treats palpable tenderness as a general "not serious" signal has introduced a defect.

**`SHADOW_GORD`** — dependency group `REFLUX_CLUSTER` (λ 0.35)

| Feature | State | LR | Note |
|---|---|---|---|
| `SX_PAIN_BURNING_QUALITY` | PRESENT | 2.60 | REFLUX_CLUSTER |
| `SX_PAIN_POSTPRANDIAL` | PRESENT | 2.30 | REFLUX_CLUSTER |
| `SX_PAIN_WORSE_SUPINE` | PRESENT | 2.10 | REFLUX_CLUSTER |
| `SX_ACID_REGURGITATION_OR_WATER_BRASH` | PRESENT | 3.00 | |
| `HX_KNOWN_REFLUX_OR_PPI_USE` | PRESENT | 2.70 | |
| `SX_RELIEVED_BY_ANTACID` | PRESENT | **1.15** | Deliberately near-unity. Antacid response is a notoriously poor discriminator; ACS pain responds to antacids at similar rates. Any file assigning this a large LR is wrong. |
| `SX_EXERTIONAL_ONSET` | PRESENT | 0.45 | |
| `VS_SPO2_ROOM_AIR` | LT_90 | 0.10 | |

**`SHADOW_DANGEROUS_OOS`** (dissection, pneumothorax, tension pneumothorax)

Most of its discriminating features are also red flags, so in practice a high posterior here usually coincides with a halt. It exists for the sub-threshold case: features suggestive but no single rule met.

| Feature | State | LR | Note |
|---|---|---|---|
| `SX_PAIN_QUALITY_TEARING` | PRESENT | 12.00 | also RF-03 |
| `SX_ONSET_TO_PEAK_LT_60S` | PRESENT | 4.50 | also RF-03 |
| `SX_PAIN_RADIATES_TO_BACK_INTERSCAPULAR` | PRESENT | 3.80 | not itself a red flag |
| `HX_MARFAN_OR_CONNECTIVE_TISSUE_DISORDER` | PRESENT | 8.00 | |
| `HX_UNCONTROLLED_HYPERTENSION` | PRESENT | 2.20 | |
| `HX_TALL_THIN_YOUNG_MALE_HABITUS` | PRESENT | 2.50 | pneumothorax |
| `HX_SMOKING_CURRENT` | PRESENT | 1.60 | |
| `EX_UNILATERAL_REDUCED_BREATH_SOUNDS` | PRESENT | 6.00 | reduced, not absent; absent + instability is RF-11 |
| `EX_SUBCUTANEOUS_EMPHYSEMA` | PRESENT | 9.00 | |
| `SX_ONSET_SUDDEN_DYSPNOEA` | PRESENT | 2.00 | |

**`SHADOW_OTHER`** — flat by design. All features LR 1.00 except a small set: `VS_TEMPERATURE ≥ 38.0` LR 2.40, `SX_PRODUCTIVE_COUGH` LR 2.60, `EX_DERMATOMAL_RASH` LR 8.00, `SX_PAIN_RIGHT_UPPER_QUADRANT_RADIATION` LR 3.00. It is a deliberately uninformative sink: it holds mass, it does not compete. Its posterior rising is a signal that the pack is missing a condition, and it is monitored as a model-quality metric.

### 5.5 Aggregation and the veil

Internal computation is over all nine hypotheses. Normalisation is over all nine. Nothing about the maths distinguishes shadows from candidates.

At the reporting layer:

```
unknown.probability = Σ posterior(h) for h in SHADOWS
```

Reported to 4 dp. `posteriors` contains exactly the four candidates. `unknown.composition_disclosed` is `false`.

**Why the veil.** Disclosing "anxiety 41%" produces the exact harm this system exists to avoid: it hands the clinician a reassuring label, anchors them, and licenses discharge. The demographics of that failure — young patients, women, patients with a psychiatric history — are well documented. The residual is reported as residual: *we cannot account for this*, not *this is nothing*.

**Hidden ≠ unauditable.** Shadow composition is always written to the trace, always available via `/v1/sessions/{id}/trace`, and available in the response body when `options.return_shadow_composition: true` **and** the caller holds the `DEBUG_SHADOW` scope. Every such disclosure emits a `SAFETY`-severity audit entry. The clinician-facing UI never holds this scope.

**Reporting rules keyed on UNKNOWN:**
- `unknown.probability > 0.50` → `confidence.assessment: INDETERMINATE`; report leads with the residual.
- `unknown.probability > 0.70` → report states that the presentation is not well explained by the modelled conditions and that broadening the differential is indicated. Candidate posteriors are still shown, below this statement.
- The word "UNKNOWN" is never rendered adjacent to any reassuring language.

### 5.6 The veil break — the one carve-out

**Rule VB-01.** If `posterior(SHADOW_DANGEROUS_OOS) ≥ 0.10`, the veil breaks for that hypothesis only.

Output gains:

```json
"escalation": {
  "reason_code": "DANGEROUS_OUT_OF_SCOPE_THRESHOLD",
  "probability": 0.1400,
  "message": "Features present are associated with serious conditions outside this tool's scope (including aortic dissection and pneumothorax). This is not a diagnosis. Senior review and appropriate imaging pathways should be considered before relying on the differential below.",
  "contributing_features": ["SX_PAIN_RADIATES_TO_BACK_INTERSCAPULAR", "HX_UNCONTROLLED_HYPERTENSION"]
}
```

- The escalation renders **above** the differential.
- It names the category, never a specific diagnosis, and never a probability for a named condition.
- It does **not** halt: no red flag rule was met, and halting on a soft signal would train users to dismiss halts.
- `SHADOW_DANGEROUS_OOS` still does not appear in `posteriors`; its mass remains inside `unknown.probability`. Only the escalation surfaces.
- Emits `SHADOW_VEIL_BROKEN` at `SAFETY` severity.

**Safety floor SF-01.** Independently of the veil: shadow hypotheses may take probability mass from candidates, but the report must surface any candidate crossing its own escalation threshold regardless of `unknown.probability`. Defaults: PE 0.10, UA 0.10, CHF 0.15, pericarditis 0.20. A high UNKNOWN never suppresses a candidate escalation. Shadows compete for mass; they do not compete for the clinician's attention when something dangerous is on the board.

### 5.7 Clinical reasoning — why these five

**Anxiety/panic.** Highest-prevalence non-cardiac cause in ED chest pain and the largest source of diagnostic anchoring in this space. Modelling it explicitly means its probability mass is accounted for rather than being distributed across the four cardiac candidates and inflating them. Hiding it means the system cannot be used to justify a psychiatric label.

**Musculoskeletal.** The single largest category in primary care, and the source of the most dangerous false-reassurance heuristic in the whole domain — reproducible tenderness. Explicit modelling lets us state precisely how much that finding argues against ACS (a fair amount) versus against PE (very little). Left unmodelled, that distinction is lost.

**GORD.** Substantial prevalence, shares retrosternal burning with ACS, and carries the antacid-response trap. Modelling it lets us pin that trap to a near-unity LR in the schema rather than relying on every clinician remembering it.

**Dangerous out-of-scope.** These conditions are rare, rapidly lethal, and *not* in the candidate set. Without a hypothesis to hold their evidence, their characteristic features get absorbed by whichever candidate is nearest — interscapular radiation nudging pericarditis, sudden dyspnoea nudging PE — and the system quietly launders a dissection into a plausible-looking cardiac differential. This shadow is the mechanism by which the model can say *this is not one of mine, and it is not benign*.

**Other.** Prevents closed-world normalisation from inflating everything else by ~40%, and serves as a model-quality instrument: sustained high `SHADOW_OTHER` posteriors across sessions indicate a missing condition in the pack.

---

## 6. ACCEPTANCE CHECKLIST FOR CHATS 1–6

- [ ] A reader who has not seen this project can write the knowledge JSON Schema from §1 alone.
- [ ] `POST /v1/evaluate` input → output is fully determined by §2.3–2.4; `status` has exactly four values.
- [ ] Every halt rule in §4.3 has a stated threshold and named input features; no rule requires judgement.
- [ ] Missing data never fires and never suppresses a halt; unevaluable rules are always reported.
- [ ] All nine hypotheses have priors, likelihoods and citations. No shadow is a fudge factor or a subtraction at report time.
- [ ] Order-independence (C1) is guaranteed by architecture (§2.1), and tested by permutation.
- [ ] No output at any layer uses prohibited language (§0.2).
- [ ] Every numeric default carries `verification_status`, and production builds reject `unverified`.

---

## 7. OPEN ITEMS REQUIRING THE CLINICAL LEAD

1. **`SHADOW_OTHER`** (§5.2) is an addition to the brief. Approve or reject.
2. **All priors and LRs** are unverified defaults. Every one needs source verification or local calibration.
3. **Escalation thresholds** (SF-01) and the **VB-01 threshold of 0.10** are engineering placeholders with no clinical basis. They set the system's operating point on the sensitivity/specificity curve and are the most consequential unvalidated numbers in this document.
4. **Fit score cutoff of 0.40** (§3.4) is likewise arbitrary pending calibration.
5. **Paediatric and obstetric scope** is excluded in v1.0. Confirm.
6. **The no-override decision** (§4.1) has workflow consequences. Confirm with the clinical governance lead.
