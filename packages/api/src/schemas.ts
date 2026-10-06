// packages/api/src/schemas.ts
/**
 * Fastify JSON Schema definitions for request/response validation.
 * Kept separate from route handlers so they can be reused and tested
 * independently, per Fastify convention.
 */

export const createSessionSchema = {
  body: {
    type: "object",
    required: ["careSetting", "patientAge", "patientSex"],
    properties: {
      careSetting: {
        type: "string",
        enum: [
          "ED_UNDIFFERENTIATED_CHEST_PAIN",
          "PRIMARY_CARE_CHEST_PAIN",
          "PREHOSPITAL",
          "TELEHEALTH_TRIAGE",
        ],
      },
      patientAge: { type: "number", minimum: 0, maximum: 130 },
      patientSex: {
        type: "string",
        enum: ["MALE", "FEMALE", "INTERSEX", "UNKNOWN"],
      },
      patientPregnancy: {
        type: "string",
        enum: ["PREGNANT", "POSTPARTUM_6WK", "NOT_PREGNANT", "UNKNOWN", "NOT_APPLICABLE"],
      },
    },
  },
} as const;

export const submitEvidenceSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  body: {
    type: "object",
    required: ["featureId", "value", "source", "observedAt", "observerConfidence"],
    properties: {
      featureId: { type: "string" },
      value: { type: "string" },
      rawValue: { type: ["number", "string"] },
      source: {
        type: "string",
        enum: ["MEASURED", "OBSERVED", "PATIENT_REPORTED", "CARER_REPORTED", "RECORD"],
      },
      observedAt: { type: "string", format: "date-time" },
      observerConfidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    },
  },
} as const;

export const correctEvidenceSchema = {
  params: {
    type: "object",
    required: ["id", "eid"],
    properties: {
      id: { type: "string" },
      eid: { type: "string" },
    },
  },
  body: {
    type: "object",
    required: ["featureId", "value", "source", "observedAt", "observerConfidence"],
    properties: {
      featureId: { type: "string" },
      value: { type: "string" },
      rawValue: { type: ["number", "string"] },
      source: {
        type: "string",
        enum: ["MEASURED", "OBSERVED", "PATIENT_REPORTED", "CARER_REPORTED", "RECORD"],
      },
      observedAt: { type: "string", format: "date-time" },
      observerConfidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    },
  },
} as const;

export const sessionIdParamSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
} as const;

export const deferSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  body: {
    type: "object",
    required: ["featureId"],
    properties: { featureId: { type: "string" } },
  },
} as const;