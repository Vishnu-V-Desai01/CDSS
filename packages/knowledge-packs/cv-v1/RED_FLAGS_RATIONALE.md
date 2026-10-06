# Red Flags — Design Rationale

Red flags (RF-01..RF-05) are deterministic policy rules, not
literature-derived evidence. Unlike condition features, they carry no
citation_id or derived_from, because they encode clinical judgement about
when to stop differential reasoning and escalate — not a probabilistic
relationship between a finding and a diagnosis.

## Why six new registry features were added

The original features.registry.yaml was sourced entirely for differential
LR calculations (Wells/Geneva/PERC for PE, physical signs for CHF, chest
pain characteristics for UA, exam findings for pericarditis). It contained
no acute danger/vital-sign features, because none of the four candidate
conditions' LR-based scoring needs them.

Six atomic features were added specifically to support red-flag triggers:
SYSTOLIC_BLOOD_PRESSURE_CATEGORY, HEART_RATE_CATEGORY,
OXYGEN_SATURATION_CATEGORY, SYNCOPE, ECG_ST_ELEVATION,
MUFFLED_HEART_SOUNDS. These are never referenced in any condition file's
`features` list and carry no `dependency_group`, because they never
participate in the probabilistic differential model — they only gate the
halt.

Three features were reused as-is: JVD, ORTHOPNEA, PULMONARY_RALES —
already sourced for CHF's differential (Wang 2005), now doing double duty
as tamponade/pulmonary-oedema red-flag triggers.

## Threshold sources

Thresholds (SBP < 90, HR > 130, SpO2 < 88%) reflect standard critical-care
convention rather than a specific cited paper, consistent with how
red-flag policy is defined throughout emergency medicine practice —
deterministic safety thresholds, not diagnostic likelihood ratios.