import { createRequire } from "node:module";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { conditionSchema, citationsSchema, featuresRegistrySchema, redFlagsSchema } from "@cds/schema";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats").default as (ajv: Ajv) => void;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

export const validateCondition: ValidateFunction = ajv.compile(conditionSchema);
export const validateCitations: ValidateFunction = ajv.compile(citationsSchema);
export const validateFeaturesRegistry: ValidateFunction = ajv.compile(featuresRegistrySchema);
export const validateRedFlags: ValidateFunction = ajv.compile(redFlagsSchema);

export function formatAjvErrors(errors: ErrorObject[] | null | undefined, filePath: string): string[] {
  if (!errors) return [];
  return errors.map((e) => `${filePath}: ${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}