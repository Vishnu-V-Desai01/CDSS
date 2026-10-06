# Extraction Notes — Pulmonary Embolism

Not schema-validated. Companion to `pulmonary_embolism.knowledge.yaml`,
which has no free-text field for caveats (additionalProperties: false
throughout). Read this alongside the YAML before marking anything "verified."

## Denominator problem (prior_probabilities)
The prior (0.069) is mapped to `ED_UNDIFFERENTIATED_CHEST_PAIN` but is actually
drawn from a *suspected-PE* cohort (Kline 2008) — clinicians had already decided
to work these patients up for PE. This is not a fully undifferentiated
chest-pain/dyspnea population. Flagged from the start of this project as the
"denominator problem." Replace with a primary-care or true undifferentiated-ED
epidemiology source when found.

## Dependency group is a structural judgment call
`CLINICAL_PRETEST_SCORES` (λ=0.15) groups PERC, Wells×2, Revised Geneva, and
Simplified Geneva because they share overlapping input variables. The λ value
itself is not literature-derived — it's an engineering choice to prevent the
Bayesian engine from over-weighting five re-expressions of the same clinical
picture. Needs clinical lead sign-off.

## Small-stratum LRs — reliability concern
- **Revised Geneva HIGH**: n=7, PE+=5 (Klok 2008). Extremely small stratum.
  LR=12.80 should not be trusted at face value. Consider downgrading to
  Expert Estimate tier or widening uncertainty handling until a larger
  validation source is found.
- **Wells HIGH**: n=26, PE+=20 (Righini 2006). Also small; LR=11.52 carries
  wide uncertainty not captured by the point estimate.
- **Simplified Geneva HIGH**: n=33, PE+=15 (Robert-Ebadi 2017). Somewhat larger
  but still worth flagging. Note this LR (3.76) is *lower* than Wells-HIGH or
  RGS-HIGH because SGS classifies very few patients as High (2% of cohort) —
  sensitivity is low even though within-stratum prevalence (45.5%) is high.
  Counterintuitive but correct; worth walking through in the viva.

## D-dimer n / prevalence_in_study are approximations
Di Nisio 2007 is a meta-analysis (81 studies, 111 PE evaluations), not a
single cohort. The schema's `n` and `prevalence_in_study` fields assume a
single-study context. I used the **number of contributing studies** per assay
category (Table 4: ELFA=20, microplate ELISA=15, latex quantitative=23) as `n`,
and the **median PE incidence** reported for that assay category as
`prevalence_in_study`. This is a stand-in, not a real single-cohort value.
Flag if this needs to be handled differently in the engine.

## Wells subjectivity — not mechanically evaluable
Wells (both forms) includes "alternative diagnosis less likely than PE,"
a clinician gestalt judgment. Cannot be computed from structured input alone.
If the engine needs to auto-compute Wells, this item needs either (a) removal
in favor of Revised/Simplified Geneva (fully objective), or (b) an explicit
clinician-input field. Flag for Chat 3.

## Not yet extracted (pending)
1. Individual finding-level LRs (leg swelling, hemoptysis, tachycardia as
   standalone findings, independent of any score). Wells 2000 (RP_7) reports
   regression odds ratios, not clean 2x2 tables — do not hand-derive without
   flagging the approximation explicitly. Still need JAMA Rational Clinical
   Examination series or equivalent.
2. PIOPED II (CTPA imaging accuracy) — no imaging features in this file yet.
3. `expected_profile` — left empty. Hallmark/weight values need deliberate
   clinical authoring, not literature LR-derivation; separate task.
4. `red_flag_links` — left empty. Depends on `red-flags.json`, a separate
   Chat 1 deliverable not yet built.
5. `mimics` — populated with plausible candidate/shadow conditions as a
   structural placeholder (clinical judgment, not a numeric claim from a
   paper). Should be reviewed by clinical lead, not treated as sourced fact.

## Verification ledger
ALL `verification_status: unverified` fields in the YAML require a human to
open the cited PDF, check the table, and flip the flag. Nothing in this file
has been checked against source yet — everything here was computed by Claude
from raw counts in the papers' own tables (cross-checked once, against
Kline 2008's own directly-reported LR-, and it matched).