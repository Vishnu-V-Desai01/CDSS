# Extraction Notes — Congestive Heart Failure

## Denominator: genuinely improved over PE
Prior (0.469) is sourced from McCullough/Maisel 2002, a consecutive-enrollment
ED dyspnea cohort NOT pre-selected for suspected CHF. This is materially
better than PE's suspected-PE-cohort problem. Residual mismatch: this
population is dyspnea-chief-complaint specifically, while the schema's single
ED prior key is meant to cover chest-pain-or-dyspnea broadly. Flagged, not
fixed.

## Meta-analysis pooling artifact — three specificities refined
Wang 2005 pools sensitivity, specificity, and LR as SEPARATE random-effects
parameters, not derived from one shared 2x2 table. Combined with 2-sig-fig
rounding of specificity in the published tables, this caused three findings
(S3 gallop, CXR pulmonary venous congestion, CXR interstitial edema) to fail
the schema's ±5% LR cross-check when using the paper's rounded specificity
at face value. Fixed by back-solving a more precise specificity from the
paper's own reported LR and sensitivity (both from the same table) --
this is arithmetic reconciliation, not invention, but every clinical lead
review should re-check these three by hand.

## Framingham criteria — deliberately not sourced
McKee 1971 (original Framingham diagnostic criteria) was paywalled and not
obtained. Judgment call: not pursuing it further, since Wang 2005 supersedes
it for individual-finding purposes -- newer, ED-dyspnea-specific, larger
combined evidence base, and gives clean LRs for the same clinical exam
elements Framingham's major/minor criteria capture. If clinical lead wants
Framingham specifically (e.g., because Chat 0's spec or a viva question
references it by name), it still needs to be sourced separately.

## NT-proBNP — deferred, not just BNP's twin
Bayes-Genis 2023 (ESC HFA consensus) gives clean, guideline-endorsed
NT-proBNP cutpoints (rule-out <=300 pg/mL, age-adjusted rule-in bands) but
does NOT report sensitivity/specificity for them in the extracted text --
it cites ICON (Januzzi 2006) and ICON-RELOADED (Januzzi 2018) as the
underlying derivation studies. Per project sourcing rules, no LR enters the
file without an opened source providing derived_from data, so NT-proBNP is
NOT in this file. BNP (not NT-proBNP -- a related but distinct biomarker
with different half-life and thresholds) is used instead via Wang 2005 and
McCullough 2002, which do have full data. Source ICON directly to add
NT-proBNP as a separate, parallel feature later -- do not conflate BNP and
NT-proBNP thresholds, they are numerically different scales.

## Dependency group judgment calls (structural, not literature-derived)
- S3 gallop deliberately kept OUT of CONGESTION_SIGN_CLUSTER despite
  correlating with volume status, to preserve its distinct signal as the
  single best individual predictor (LR+ 11). Reviewer should sanity-check
  this choice.
- Prior CHF history deliberately kept OUT of ISCHEMIC_HISTORY_CLUSTER --
  treated as a more direct/specific predictor than MI/CAD risk-factor proxies.
- ECG_ANY_ABNORMAL_FINDING likely overlaps with (contains) the other two ECG
  features as components -- flagged for possible deprecation once reviewed,
  rather than kept as a third "independent" ECG data point.

## Initial clinical judgment — same structural problem as PE's Wells item
INITIAL_CLINICAL_JUDGMENT_CHF is the clinician's gestalt synthesis of
history + exam + CXR + ECG -- i.e., built from the same inputs as every
other feature in this file. Not statistically independent of them, and the
schema has no cross-group redundancy mechanism to handle this (only
within-group). Recommend engine/UI treat this as an alternative summary
path, not an additive input alongside the granular findings. Same category
of issue as PE's Wells "alternative diagnosis" subjectivity flag -- raise
to Chat 3 as a recurring pattern across conditions, not a one-off.

## Not yet extracted (pending)
1. NT-proBNP (see above) -- need ICON/ICON-RELOADED primary papers.
2. Echocardiographic findings (LVEF cutoffs, diastolic dysfunction markers)
   -- not sourced yet, separate search needed.
3. `expected_profile` -- left empty, same as PE, pending deliberate clinical
   authoring of hallmark/weight values.
4. `red_flag_links` -- left empty, pending red-flags.json.
5. Verification ledger: ALL states in this file are `unverified`. Nothing
   has been spot-checked against source PDFs yet -- do that before trusting
   any individual value, same protocol as PE.