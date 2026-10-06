/**
 * Formatting, option lists, and CLIENT-SIDE validation only. No clinical
 * computation: these four fields map 1:1 onto POST /session's body, and the
 * care-setting list comes from the server (GET /health), never from here.
 */
import {
  PREGNANCY_STATUS,
  type CareSetting,
  type PregnancyStatus,
} from '@cds/shared-types';
import type {
  PatientIntakeFormValues,
  FieldErrors,
  CareSettingOption,
} from './PatientIntakeForm';

// shared-types has no runtime array for sex-at-birth (only inline literal
// unions). Matches createSessionSchema's enum exactly. Worth adding
// SEX_AT_BIRTH to shared-types/enums.ts so there is one source of truth.
const SEX_AT_BIRTH = ['MALE', 'FEMALE', 'INTERSEX', 'UNKNOWN'] as const;

// Display wording only. A setting the server reports but this map lacks is
// shown by its raw id rather than hidden. Exported so the Active Session
// header can reuse the same wording.
export const CARE_SETTING_LABELS: Record<CareSetting, string> = {
  ED_UNDIFFERENTIATED_CHEST_PAIN: 'Emergency Department — Undifferentiated Chest Pain',
  PRIMARY_CARE_CHEST_PAIN: 'Primary Care — Chest Pain',
  PREHOSPITAL: 'Prehospital',
  TELEHEALTH_TRIAGE: 'Telehealth Triage',
};

export const SEX_LABELS: Record<(typeof SEX_AT_BIRTH)[number], string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  INTERSEX: 'Intersex',
  UNKNOWN: 'Unknown',
};

const PREGNANCY_LABELS: Record<PregnancyStatus, string> = {
  PREGNANT: 'Pregnant',
  POSTPARTUM_6WK: 'Postpartum (within 6 weeks)',
  NOT_PREGNANT: 'Not pregnant',
  UNKNOWN: 'Unknown',
  NOT_APPLICABLE: 'Not applicable',
};

/** Options for exactly the care settings the server says it can serve. */
export function toCareSettingOptions(supported: readonly string[]): CareSettingOption[] {
  return supported.map((value) => ({
    value,
    label: (CARE_SETTING_LABELS as Record<string, string>)[value] ?? value,
  }));
}

export const sexOptions: CareSettingOption[] = SEX_AT_BIRTH.map((value) => ({
  value,
  label: SEX_LABELS[value],
}));

export const pregnancyOptions: CareSettingOption[] = PREGNANCY_STATUS.map((value) => ({
  value,
  label: PREGNANCY_LABELS[value],
}));

export const EMPTY_INTAKE_VALUES: PatientIntakeFormValues = {
  careSetting: '',
  patientAge: '',
  patientSex: '',
  // Pregnancy is optional in the API schema, but the client always sends an
  // explicit value so "not asked" is never ambiguous with a real UNKNOWN.
  patientPregnancy: 'UNKNOWN',
};

const AGE_MIN = 0;
const AGE_MAX = 130; // matches createSessionSchema exactly

export function validateIntake(values: PatientIntakeFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.careSetting) {
    errors.careSetting = 'Care setting is required.';
  }

  if (!values.patientAge.trim()) {
    errors.patientAge = 'Age is required.';
  } else {
    const age = Number(values.patientAge);
    if (Number.isNaN(age)) {
      errors.patientAge = 'Age must be a number.';
    } else if (age < AGE_MIN || age > AGE_MAX) {
      errors.patientAge = `Age must be between ${AGE_MIN} and ${AGE_MAX}.`;
    }
  }

  if (!values.patientSex) {
    errors.patientSex = 'Sex is required.';
  }

  if (!values.patientPregnancy) {
    errors.patientPregnancy = 'Pregnancy status is required.';
  }

  return errors;
}

export function toCreateSessionRequest(values: PatientIntakeFormValues) {
  return {
    careSetting: values.careSetting,
    patientAge: Number(values.patientAge),
    patientSex: values.patientSex as 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN',
    patientPregnancy: values.patientPregnancy as
      | 'PREGNANT'
      | 'POSTPARTUM_6WK'
      | 'NOT_PREGNANT'
      | 'UNKNOWN'
      | 'NOT_APPLICABLE',
  };
}