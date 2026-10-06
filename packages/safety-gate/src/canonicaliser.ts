// packages/safety-gate/src/canonicaliser.ts
/**
 * Canonicalise raw vitals into categorical states per spec §4.3.
 *
 * INPUT: raw numbers or pre-binned categorical states
 * OUTPUT: canonical categorical states for gate evaluation + validity report
 *
 * Spec §4.3 thresholds — NON-NEGOTIABLE, sourced line-by-line:
 * - SBP < 90 mmHg → HYPOTENSIVE [or < 100 if pregnant/postpartum per §4.3]
 * - MAP < 65 mmHg → HYPOTENSIVE
 * - HR > 130 bpm → SEVERE_TACHYCARDIA [or > 140 if pregnant/postpartum]
 * - HR < 40 bpm → BRADYCARDIA
 * - SpO2 < 88% → SEVERE_HYPOXIA
 * - SpO2 88-93% → MILD_HYPOXIA
 * - SpO2 >= 94% → NORMAL
 */

export interface PatientModifiers {
  isPregnant: boolean;
  isPostpartum6wk: boolean;
  ageYears: number;
}

export interface CanonicalEvidenceState {
  [key: string]: string | null;
}

export interface CanonicaliserResult {
  canonical: CanonicalEvidenceState;
  /** Features that couldn't be canonicalised (invalid numeric, missing, etc.) */
  errors: Array<{
    featureId: string;
    error: string;
  }>;
}

/**
 * Canonicalise raw vitals to categorical states per spec §4.3.
 * Returns both the canonical state map and any errors encountered.
 */
export function canonicalise(
  rawEvidence: Record<string, number | string | null | undefined>,
  modifiers: PatientModifiers,
): CanonicaliserResult {
  const canonical: CanonicalEvidenceState = {};
  const errors: Array<{ featureId: string; error: string }> = [];

  // SBP → SYSTOLIC_BLOOD_PRESSURE_CATEGORY
  // Spec §4.3 RF-01: "SBP < 90 mmHg" (< 100 if pregnant)
  if ("VS_SBP" in rawEvidence && rawEvidence.VS_SBP != null) {
    const sbp = toNumber(rawEvidence.VS_SBP);
    if (sbp === null) {
      errors.push({
        featureId: "VS_SBP",
        error: `Must be numeric (received: ${JSON.stringify(rawEvidence.VS_SBP)}, typeof: ${typeof rawEvidence.VS_SBP})`,
      });
    } else {
      const threshold = modifiers.isPregnant || modifiers.isPostpartum6wk ? 100 : 90;
      if (sbp < threshold) {
        canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"] = "HYPOTENSIVE";
      } else if (sbp < 140) {
        canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"] = "NORMAL";
      } else {
        canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"] = "HYPERTENSIVE";
      }
    }
  }

  // MAP (from SBP + DBP) → HYPOTENSIVE if < 65
  // Spec §4.3 RF-01: "MAP < 65 mmHg"
  // MAP = (SBP + 2*DBP) / 3
  if (
    "VS_SBP" in rawEvidence &&
    rawEvidence.VS_SBP != null &&
    "VS_DBP" in rawEvidence &&
    rawEvidence.VS_DBP != null
  ) {
    const sbp = toNumber(rawEvidence.VS_SBP);
    const dbp = toNumber(rawEvidence.VS_DBP);
    if (sbp !== null && dbp !== null) {
      const map = (sbp + 2 * dbp) / 3;
      if (map < 65 && canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"] !== "HYPOTENSIVE") {
        canonical["SYSTOLIC_BLOOD_PRESSURE_CATEGORY"] = "HYPOTENSIVE";
      }
    }
  }

  // HR → HEART_RATE_CATEGORY
  // Spec §4.3: < 40 = BRADYCARDIA, 40–99 = NORMAL, 100–130 = TACHYCARDIA,
  //            > 130 = SEVERE_TACHYCARDIA (> 140 if pregnant)
  if ("VS_HEART_RATE" in rawEvidence && rawEvidence.VS_HEART_RATE != null) {
    const hr = toNumber(rawEvidence.VS_HEART_RATE);
    if (hr === null) {
      errors.push({
        featureId: "VS_HEART_RATE",
        error: `Must be numeric (received: ${JSON.stringify(rawEvidence.VS_HEART_RATE)}, typeof: ${typeof rawEvidence.VS_HEART_RATE})`,
      });
    } else {
      const severeThreshold = modifiers.isPregnant || modifiers.isPostpartum6wk ? 140 : 130;
      if (hr < 40) {
        canonical["HEART_RATE_CATEGORY"] = "BRADYCARDIA";
      } else if (hr < 100) {
        canonical["HEART_RATE_CATEGORY"] = "NORMAL";
      } else if (hr < severeThreshold) {
        canonical["HEART_RATE_CATEGORY"] = "TACHYCARDIA";
      } else {
        canonical["HEART_RATE_CATEGORY"] = "SEVERE_TACHYCARDIA";
      }
    }
  }

  // SpO2 → OXYGEN_SATURATION_CATEGORY
  // Spec §4.3 RF-05: < 88% = SEVERE_HYPOXIA, 88–93% = MILD_HYPOXIA, >= 94% = NORMAL
  if ("VS_SPO2_ROOM_AIR" in rawEvidence && rawEvidence.VS_SPO2_ROOM_AIR != null) {
    const spo2 = toNumber(rawEvidence.VS_SPO2_ROOM_AIR);
    if (spo2 === null) {
      errors.push({
        featureId: "VS_SPO2_ROOM_AIR",
        error: `Must be numeric (received: ${JSON.stringify(rawEvidence.VS_SPO2_ROOM_AIR)}, typeof: ${typeof rawEvidence.VS_SPO2_ROOM_AIR})`,
      });
    } else {
      if (spo2 < 88) {
        canonical["OXYGEN_SATURATION_CATEGORY"] = "SEVERE_HYPOXIA";
      } else if (spo2 < 94) {
        canonical["OXYGEN_SATURATION_CATEGORY"] = "MILD_HYPOXIA";
      } else {
        canonical["OXYGEN_SATURATION_CATEGORY"] = "NORMAL";
      }
    }
  }

  // Syncope → SYNCOPE
  // Spec §4.3 RF-02: "Syncope or near-syncope reported in current episode"
  if ("SYNCOPE" in rawEvidence && rawEvidence.SYNCOPE != null) {
    const val = String(rawEvidence.SYNCOPE).toUpperCase();
    canonical["SYNCOPE"] = val === "PRESENT" ? "PRESENT" : "ABSENT";
  }

  // ECG ST elevation → ECG_ST_ELEVATION
  // Spec §4.3 RF-03/RF-10: "ST elevation ≥1mm in ≥2 contiguous leads"
  if ("ECG_ST_ELEVATION" in rawEvidence && rawEvidence.ECG_ST_ELEVATION != null) {
    const val = String(rawEvidence.ECG_ST_ELEVATION).toUpperCase();
    canonical["ECG_ST_ELEVATION"] = val === "PRESENT" ? "PRESENT" : "ABSENT";
  }

  // Pass through already-categorical features (no binning needed)
  const categoricalPassthrough = [
    "ORTHOPNEA",
    "PULMONARY_RALES",
    "JVD",
    "MUFFLED_HEART_SOUNDS",
    "CHEST_WALL_TENDERNESS",
    "PERICARDIAL_FRICTION_RUB",
    "ECG_ANY_ABNORMAL_FINDING",
  ];

  for (const feature of categoricalPassthrough) {
    if (feature in rawEvidence && rawEvidence[feature] != null) {
      const val = String(rawEvidence[feature]).toUpperCase();
      if (val === "PRESENT" || val === "ABSENT") {
        canonical[feature] = val;
      } else {
        errors.push({
          featureId: feature,
          error: `Must be PRESENT or ABSENT, got ${val}`,
        });
      }
    }
  }

  return { canonical, errors };
}

/**
 * Return the canonical minimum safety set — the observations required before
 * any posterior is emitted per spec §4.2.
 *
 * Required: HR, RR, SBP+DBP, SpO2, temperature, mental status.
 * Returns: { complete, missing }
 */
export function checkMinimumSafetySet(
  evidence: Record<string, number | string | null | undefined>,
): {
  complete: boolean;
  missing: string[];
} {
  const required = [
    "VS_HEART_RATE",
    "VS_RESP_RATE",
    "VS_SBP",
    "VS_DBP",
    "VS_SPO2_ROOM_AIR",
    "VS_TEMPERATURE",
    "EX_MENTAL_STATUS",
  ];

  const missing = required.filter((f) => !(f in evidence) || evidence[f] == null);

  return {
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Convert a value to a number, or null if not parseable.
 */
function toNumber(val: number | string | null | undefined): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val;
  const parsed = parseFloat(String(val));
  return Number.isNaN(parsed) ? null : parsed;
}