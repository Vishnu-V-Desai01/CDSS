
# EXTRACTION_NOTES — Unstable Angina (UNSTABLE_ANGINA)

Companion to `conditions/unstable_angina.knowledge.yaml`. Anything not schema-legal
(caveats, small-N warnings, pending decisions, back-solve derivations, spot-check
confirmations) lives here rather than in the YAML itself.

Last updated: 2026-08-08

---

## 1. Status summary

- **Findings sourced:** 4 (`CHEST_WALL_TENDERNESS`, `PAIN_RADIATION_RIGHT_ARM_SHOULDER`,
  `PAIN_RADIATION_NECK`, `CHEST_PAIN_OPPRESSIVE_CHARACTER`) — all from Bruyninckx 2008.
- **Findings NOT sourced, closed out for this phase:** troponin, ECG findings, TIMI
  score, HEART score. See §5, §6 for reasoning -- not pursued further given
  paywall access constraints; acceptable gap for current project scope.
- **Spot-checks completed:** 0/4. Pending -- lower priority than moving to next
  workstream; revisit if time permits before final submission.
- **Validation status:** passes `pack:validate` as of 2026-08-08.
- **Prior probability:** provisional ACS-composite proxy, accepted as-is per
  scope decision 2026-08-08 (see §2). Known to overestimate; documented, not
  resolved further.
- **File status:** CLOSED for this phase. Thinner than PE/CHF by design of
  available literature access, not by process shortcut -- every included value
  is fully traced to source; every excluded value has a documented reason.

---

## 2. Prior probability — provisional, needs revisiting

`priors.ED_UNDIFFERENTIATED_CHEST_PAIN.weight = 0.263` is Bruyninckx 2008's pooled
**ACS** prevalence (4594/17416, combined selected+non-selected populations), used
as a stand-in because no accessible source reports UA-specific incident prevalence
in an undifferentiated chest-pain population.

**This is known to be biased high**, since ACS = AMI + UA and the true UA-only
share of that 26.3% is smaller than the whole. No paper found reports a clean
UA-isolated denominator match the way McCullough 2002 did for CHF.

**Sources checked and found inaccessible (paywalled):**
- Goodacre SW et al. "Clinical predictors of acute coronary syndromes in patients
  with undifferentiated chest pain." QJM. 2003;96(12):893-898. — Directly cited by
  Bruyninckx (ref 45) as one of only two true non-selected/undifferentiated-setting
  studies in their pooled analysis. Best candidate for a clean UA-vs-AMI-vs-neither
  breakdown. Oxford Academic paywall, 24hr rental only, not obtained.
- Panju A et al. "Is This Patient Having a Myocardial Infarction?" JAMA.
  1998;280(14):1256-1263. — No PMC or open-access version found.
- Antman EM et al. TIMI risk score original derivation. JAMA. 2000;284:835-842. —
  Paywalled.
- Backus BE et al. HEART score external validation. Int J Cardiol.
  2013;168:2153-2158. — Paywalled.

**Action item:** if institutional/library access becomes available, Goodacre 2003
is the highest-priority single paper to re-attempt, specifically for the prior.

---

## 3. Back-solved specificity corrections

Same method used for Wang 2005 (S3 gallop, CXR pulmonary venous congestion, CXR
interstitial edema) in the CHF file: when a paper's directly-reported LR doesn't
reconcile with its own rounded sensitivity/specificity within the schema's ±5%
tolerance, specificity is refined to more decimal places by back-solving from the
paper's own reported LR and sensitivity — not invented, both source values are
from the same table.

### 3.1 CHEST_WALL_TENDERNESS

Bruyninckx reports sens/spec for the test framed as **"absence of tenderness"**
(94%/33%), not for tenderness PRESENT. Reframed to this schema's PRESENT-keyed
convention:

- Raw complement: sensitivity = 1 − 0.94 = 0.06, specificity = 1 − 0.33 = 0.67
- Computed LR(PRESENT) = 0.06 / (1 − 0.67) = 0.182
- Paper's reported LR− (= LR for tenderness PRESENT in this reframing) = 0.17
- Gap: |0.182 − 0.17| / 0.182 = 6.5% — **exceeds 5% tolerance**

Refined by back-solving specificity from the paper's own sensitivity and LR−:
Check: 0.06 / (1 − 0.6471) = 0.1700 ✓ exact match to paper's LR−.
Check LR+ (ABSENT state): (1 − 0.06) / 0.6471 = 1.453 vs. paper's reported LR+
1.41 — 2.9% off, within tolerance.

**Stored values:** sensitivity=0.06, specificity=0.647 (both states), PRESENT
lr=0.17, ABSENT lr=1.41.

### 3.2 PAIN_RADIATION_RIGHT_ARM_SHOULDER

Paper reports sens=18%, spec=95% (both rounded to 2 sig figs, single study each).
Computed LR(PRESENT) = 0.18 / (1 − 0.95) = 3.600 vs. paper's reported LR+ = 3.78
— gap = 5.0%, landing exactly on the tolerance boundary and rejected by
`pack:validate` (`>5%` fails).

Refined by back-solving specificity from the paper's own sensitivity and LR+:
Check: 0.18 / (1 − 0.9524) = 3.7815 ✓ matches paper's LR+ (3.78).
Check LR− (ABSENT state): (1 − 0.18) / 0.9524 = 0.861 vs. paper's reported LR−
0.86 — 0.1% off, comfortably within tolerance.

**Stored values:** sensitivity=0.18, specificity=0.9524 (both states), PRESENT
lr=3.78, ABSENT lr=0.86.

### 3.3 PAIN_RADIATION_NECK and CHEST_PAIN_OPPRESSIVE_CHARACTER — no correction needed

Both reconciled within tolerance using the paper's directly-reported sens/spec,
no back-solving required:
- Neck: sens=0.35, spec=0.76 → computed LR+ = 1.458 vs. reported 1.44 (1.3% off);
  computed LR− = 0.855 vs. reported 0.86 (0.6% off).
- Oppressive character: sens=0.56, spec=0.67 → computed LR+ = 1.697 vs. reported
  1.68 (1.0% off); computed LR− = 0.657 vs. reported 0.66 (0.5% off).

---

## 4. Findings deliberately excluded from Bruyninckx 2008

The paper's Appendix 6 (ACS, non-selected population) reports pooled estimates
for 9 signs/symptoms. Only 4 were extracted. Excluded, with reasons:

| Finding | Reason excluded |
|---|---|
| Pain, left arm/shoulder | I²=95/97% (sens/spec) — pooled estimate averages over studies that don't agree with each other; not trustworthy despite looking precise. |
| Pain in back | Specificity 95% CI spans 26.7–98.6% — not a usable point estimate. |
| Epigastric pain | LR+ 95% CI = 0.35–3.20, **crosses 1.0** — statistically indistinguishable from no effect. Including it would misrepresent a null finding as a real one. |
| Sweating | I²=98/99% — extremely high heterogeneity. |
| Nausea/vomiting | I²=91/98% — high heterogeneity. |

Principle applied: a "clean" pooled number from a study set that disagrees with
itself (I² in the 90s) is not more trustworthy than an honestly-reported weak
finding — it's noise wearing a precise-looking mask. Consistent with the CHF
file's practice of flagging small-N strata as weak evidence rather than silently
including them.

---

## 5. HEART score (Six 2008) — DECIDED: excluded

**Decision (2026-08-08):** excluded from `findings`. Six 2008's endpoint is a
composite of AMI+PCI+CABG+death -- a prognostic outcome (predicts adverse
event), not a diagnostic one (does not directly answer "does this patient have
UA"). Including it as a citable LR would misrepresent prognostic evidence as
diagnostic evidence for this condition file's actual target.

Computed values retained here for transparency, in case a future workstream
(e.g. a prognosis/triage layer, distinct from this diagnostic knowledge pack)
finds a legitimate use for them:

- LOW (0-3): sens=1/29=0.0345, spec=53/91=0.582, LR=0.083
- MODERATE (4-6): sens=12/29=0.4138, spec=44/91=0.4835, LR=0.801
- HIGH (7-10): sens=16/29=0.5517, spec=85/91=0.9341, LR=8.371

(Computed directly from Six 2008's raw counts, N=120, not back-solved from any
LR.)

---

## 6. Still needed (not started)

- Troponin (any generation/assay) — the BNP/D-dimer analogue for this condition.
  Structural note: UA is *defined* by normal troponin, so troponin's role here is
  inverted relative to its usual "rule in MI" framing — this needs to be modeled
  carefully, not just copied from an AMI-rule-in source.
- ECG findings (ST depression, T-wave inversion) specific to UA/ACS.
- TIMI score — Antman 2000 paywalled; no open-access alternative found yet.
- Prior probability — see §2.

---

## 7. Spot-check queue (not yet run)

Per project standing practice, all 4 sourced findings await Vishnu's manual
spot-check against the source PDF before any `verification_status` moves off
`unverified`. Suggested order given limited time: `CHEST_WALL_TENDERNESS` first
(most consequential back-solve, best homogeneity/I²=0 for sensitivity), then
`PAIN_RADIATION_RIGHT_ARM_SHOULDER` (the boundary-case back-solve), then the two
uncorrected findings as a lower-priority pass.