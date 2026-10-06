# SHADOW_CONDITIONS_RATIONALE

Shadow conditions are **structural sinks**, not independent diagnostic targets.
They exist to capture presentations that do not match PE, UA, CHF, or
Pericarditis, so the engine doesn't force a misfit.

## Design principle

The four shadow conditions + one "OTHER" aggregate category represent the
UNKNOWN bucket. They are modeled internally with named conditions (for
inferential structure) but reported externally only as an aggregate
UNKNOWN probability.

This keeps the engine's posterior distribution honest: if a patient's findings
don't match any of the four primary conditions well, they should accumulate
probability mass in UNKNOWN, not artificially inflate one of the primaries.

## The four shadows

| Shadow | Role | Intended to capture |
|---|---|---|
| SHADOW_ANXIETY_PANIC | Functional/psychological | Chest pain in a young, anxious patient with normal ECG/troponin/imaging; hyperventilation; reproducible symptoms |
| SHADOW_MUSCULOSKELETAL | Mechanical | Reproducible chest-wall pain on palpation; pain worse with movement; no cardiac risk factors |
| SHADOW_GORD | GI | Epigastric pain, relationship to eating/recumbency, response to antacids; absence of cardiac features |
| SHADOW_DANGEROUS_OOS | Out-of-scope serious | Aortic dissection, pneumothorax, pneumonia, esophageal rupture, etc. — serious conditions that present with chest pain but are outside this system's diagnostic target and require immediate imaging/specialty consultation |

## Prior allocation

Priors are **not** evidence-based prevalence figures. They are structural weights
that sum (with the 4 primary conditions) to 100%. Currently allocated as:

- PE: 11.6% (from Bruyninckx 2008, confirmed for PE literature)
- CHF: 46.9% (from McCullough 2002, ED dyspnea cohort)
- UA: 26.3% (from Bruyninckx 2008, ACS composite — provisional)
- Pericarditis: 4.4% (from AFP 2024)
- SHADOW_ANXIETY_PANIC: 3.5% (structural estimate)
- SHADOW_MUSCULOSKELETAL: 3.5% (structural estimate)
- SHADOW_GORD: 2.5% (structural estimate)
- SHADOW_DANGEROUS_OOS: 1.2% (structural estimate — flag for immediate escalation)
- SHADOW_OTHER: 0.5% (catch-all)

**These are not validated prevalence estimates.** They are placeholders that
ensure the system can run end-to-end. In a real clinical deployment, these would
be recalibrated against actual institutional case-mix data.

## When to revisit

After the backend is built and validated against test cases, if certain shadows
consistently receive high posterior probability, that may indicate:
- A missing feature in one of the primary conditions
- A prior that needs adjustment
- A shadow that should be split (e.g., GORD and simple reflux are not the same)

For a college project, the current allocation is sufficient to demonstrate the
system working. Do not attempt to source each shadow with deep literature.