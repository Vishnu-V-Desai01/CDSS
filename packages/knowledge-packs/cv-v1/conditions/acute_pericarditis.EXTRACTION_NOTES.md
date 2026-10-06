# EXTRACTION_NOTES — Acute Pericarditis (ACUTE_PERICARDITIS)

Companion to `conditions/acute_pericarditis.knowledge.yaml`.

Last updated: 2026-08-08

---

## 1. Status summary

- **Source:** AFP 2024 guideline review (open-access, non-paywalled)
- **Evidence grade:** C/D throughout — guideline-derived prevalence/sensitivity
  ranges, not diagnostic-accuracy meta-analysis
- **Findings sourced:** 4 (`CHEST_PAIN_PLEURITIC`, `PERICARDIAL_FRICTION_RUB`,
  `CHEST_PAIN_POSITIONAL_RELIEF`, `PERICARDIAL_IMAGING_ABNORMAL`)
- **Spot-checks completed:** 0/4
- **Validation status:** passes `pack:validate`
- **File status:** CLOSED for this phase. Deliberately thin relative to PE/CHF/UA,
  reflecting the actual diagnostic-accuracy literature for pericarditis (which is
  much weaker than for the other three conditions).

---

## 2. Why pericarditis is thinner than PE/CHF/UA

Acute pericarditis has **no diagnostic-accuracy meta-analyses equivalent to
Bruyninckx (ACS), Wang (CHF), or even good JAMA Rational Clinical Examination
coverage**. Most pericarditis diagnostic literature is:

- Small single-center cohort studies from cardiology units (selection bias toward
  confirmed cases)
- Consensus-guideline-derived prevalence estimates rather than sens/spec from
  prospective populations
- Reported as ranges (e.g., "friction rub present in 18–84% of patients") rather
  than clean point estimates

**This is not a project failure; it reflects the reality of the clinical
literature on pericarditis.** Pericarditis is rarer than PE/CHF/UA in ED
undifferentiated-chest-pain populations (4.4% vs. 11–26% for the others), and
thus attracts less diagnostic-accuracy research.

**Sourced from:** American Academy of Family Physicians, 2024, "Acute Pericarditis"
(free full-text online). Guideline-based prevalence and clinical feature
prevalence ranges converted to point estimates (midpoint of reported ranges, or
taken directly when a single value was given).

---

## 3. Conversion of prevalence ranges to LR point estimates

All four findings reported as prevalence ranges in AFP 2024. Converted as follows
(lowest defensible estimate used, not artificially inflated):

### Pleuritic chest pain
- AFP reports: ">90% of patients with acute pericarditis present with pleuritic
  chest pain"
- Used: sensitivity = 0.90
- Specificity estimated from literature: pleuritic pain is common in PE (>50%),
  occurs in musculoskeletal pain (~30%), and in GORD (~20%); used 0.25 as a
  conservative cross-condition estimate
- LR+ = 0.90 / (1 − 0.25) = 1.2; LR− = 0.10 / 0.25 = 0.40

### Pericardial friction rub
- AFP reports: "Present in 18–84% of patients" (very wide range, transient,
  operator-dependent)
- Used: sensitivity = 0.40 (lower end, reflects real-world detection)
- High specificity: rub is very specific for pericarditis when present (94% used)
- LR+ = 0.40 / (1 − 0.94) = 6.5; LR− = 0.60 / 0.94 = 0.64

### Chest pain positional relief (leaning forward, worsens supine)
- AFP reports: "Positional variation in pain occurs in ~46% of pericarditis cases"
- Used: sensitivity = 0.46
- Specificity estimated: positional symptoms can occur in MSK (~79%) but are
  pathognomonic enough for pericarditis when combined with other features; used
  0.79
- LR+ = 0.46 / (1 − 0.79) = 2.2; LR− = 0.54 / 0.79 = 0.69

### Pericardial imaging abnormality (CT/CMR showing thickening or enhancement)
- AFP reports: "Sensitivity 54–59% for confirming pericarditis, specificity
  91–96%"
- Used: sensitivity = 0.56 (midpoint), specificity = 0.93 (midpoint)
- LR+ = 0.56 / (1 − 0.93) = 8.1; LR− = 0.44 / 0.93 = 0.47
- **Note:** imaging is high-specificity but not universally ordered in ED
  undifferentiated-chest-pain workup; flagged as MILD invasiveness to reflect
  that it requires clinical decision to pursue

---

## 4. Honest caveats for viva/defense

**Known issues with this file:**

1. **Pleuritic pain is not pericarditis-specific.** PE also presents with pleuritic
   pain >50% of the time. This file's LR of 1.2 (barely informative) correctly
   reflects that; don't artificially inflate it.

2. **Friction rub is the classic finding but not present in all cases.** The wide
   range (18–84%) reflects real variability (operator skill, timing in disease
   course, pericardial effusion obscuring the rub). Using 40% rather than the
   optimistic 84% is more defensible for an ED workup where many rubs go unheard.

3. **Positional relief is suggestive but overlaps with MSK pain.** This file's
   specificity of 0.79 reflects that some non-pericarditis chest pain can be
   positional; it's not pathognomonic.

4. **No ECG features included.** Acute pericarditis has classic ECG findings
   (diffuse ST elevation, PR depression), but they're not universally present
   early in the disease course. Omitting them is a real gap, but ECG grading and
   interpretation requires expertise-level literature sourcing, which was outside
   scope for this phase.

5. **No troponin included.** Myopericarditis (concurrent myocardial inflammation)
   can elevate troponin, causing direct overlap with UA. No attempt was made to
   differentiate "pericarditis-only" from "myopericarditis with troponin elevation"
   in this sourcing. This is a known limitation flagged here for future refinement.

---

## 5. Spot-check queue

All 4 findings are at "unverified" status. Spot-check plan (if time permits):
1. Verify AFP 2024's reported ranges against the underlying studies it cites
2. Check whether any of the underlying studies report clean 2×2 tables that would
   allow more precise sens/spec extraction than the guideline ranges
3. Verify that specificity estimates (0.25 for pleuritic, 0.79 for positional)
   are reasonable cross-condition estimates given PE/MSK/GORD prevalence

Currently deprioritized in favor of moving to backend development.

---

## 6. Future sourcing (not pursued this phase)

If this file is revisited:
- **ECG criteria** (ST elevation, PR depression) — source from guidelines (ESC
  2015 Pericardial Diseases guideline, but paywalled) or a cardiology review
- **Troponin elevation in myopericarditis** — likely requires small prospective
  cohort studies from cardiology centers, hard to find in open-access form
- **Pericardial effusion size/tamponade risk** — structured guideline criteria
  exist but don't translate to clean LR format
- **Constrictive physiology** (rare in acute pericarditis, more relevant to
  chronic) — not attempted