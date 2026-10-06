import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PatientIntakeForm, {
  type PatientIntakeFormValues,
  type FieldErrors,
} from './PatientIntakeForm';
import {
  EMPTY_INTAKE_VALUES,
  toCareSettingOptions,
  sexOptions,
  pregnancyOptions,
  validateIntake,
  toCreateSessionRequest,
} from './view-model';
import { createSession, getHealth } from '../../api/endpoints';
import { NetworkError, HttpError, ContractError, extractServerMessage } from '../../api/errors';

export default function IntakeContainer() {
  const navigate = useNavigate();

  const [values, setValues] = useState<PatientIntakeFormValues>(EMPTY_INTAKE_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // null = not loaded yet (or failed). Never defaulted to a guess.
  const [supportedCareSettings, setSupportedCareSettings] = useState<string[] | null>(null);

  const loadHealth = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const health = await getHealth();
      if (isCancelled()) return;
      setSupportedCareSettings(health.supportedCareSettings);
      setFormError('');
      // A single supported setting is preselected; nothing to choose between.
      if (health.supportedCareSettings.length === 1) {
        const only = health.supportedCareSettings[0]!;
        setValues((prev) => (prev.careSetting === '' ? { ...prev, careSetting: only } : prev));
      }
    } catch (err) {
      if (isCancelled()) return;
      setSupportedCareSettings(null);
      setFormError(describeError(err, 'Could not load the supported care settings'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadHealth(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadHealth]);

  function handleFieldChange(field: keyof PatientIntakeFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear that field's error on edit. Leave formError alone: a
    // server-level failure isn't resolved by touching one field.
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit() {
    // Without the server's list there is nothing valid to submit. Pressing
    // the button retries the load instead of showing a misleading
    // "Care setting is required".
    if (supportedCareSettings === null) {
      setIsSubmitting(true);
      await loadHealth();
      setIsSubmitting(false);
      return;
    }

    const errors = validateIntake(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return; // never calls the API on a client-side validation failure
    }

    setFieldErrors({});
    setFormError('');
    setIsSubmitting(true);

    try {
      const session = await createSession(toCreateSessionRequest(values));
      // Server is authoritative from here: hand off sessionId only.
      navigate(`/session/${session.metadata.sessionId}/active`);
    } catch (err) {
      setFormError(describeError(err, 'Session could not be created'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PatientIntakeForm
      values={values}
      onFieldChange={handleFieldChange}
      onSubmit={handleSubmit}
      fieldErrors={fieldErrors}
      formError={formError}
      isSubmitting={isSubmitting}
      careSettingOptions={toCareSettingOptions(supportedCareSettings ?? [])}
      sexOptions={sexOptions}
      pregnancyOptions={pregnancyOptions}
    />
  );
}

/**
 * Three distinct failure shapes get three distinct messages. A dead backend
 * and a rejected request are not the same problem and shouldn't read the
 * same during a demo.
 */
function describeError(err: unknown, action: string): string {
  if (err instanceof NetworkError) {
    return 'Cannot reach the backend. Confirm the API server is running, then press Start Session to retry.';
  }
  if (err instanceof HttpError) {
    const detail = extractServerMessage(err.body) ?? `HTTP ${err.status}`;
    return `${action}: ${detail}`;
  }
  if (err instanceof ContractError) {
    return 'The server response did not match the expected format. This is a bug; please report it.';
  }
  return 'An unexpected error occurred.';
}