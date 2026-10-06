import { request } from './client';
import {
  assertSessionState,
  assertHealthInfo,
  type HealthInfo,
} from './validate';
import { assertSourcesData, type SourcesData } from './validateSources';
import type { SessionState } from '@cds/session-store';

export interface StartSessionInput {
  careSetting: string;
  patientAge: number;
  patientSex: 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';
  patientPregnancy: 'PREGNANT' | 'POSTPARTUM_6WK' | 'NOT_PREGNANT' | 'UNKNOWN' | 'NOT_APPLICABLE';
}

export type EvidenceSource =
  | 'MEASURED'
  | 'OBSERVED'
  | 'PATIENT_REPORTED'
  | 'CARER_REPORTED'
  | 'RECORD';

/** Body of POST /session/:id/evidence and POST /session/:id/evidence/:eid. */
export interface EvidenceInput {
  featureId: string;
  value: string;
  rawValue?: number | string;
  source: EvidenceSource;
  observedAt: string;
  observerConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Pack-level, not session-scoped: takes no sessionId. */
export function getHealth(): Promise<HealthInfo> {
  return request({ method: 'GET', path: '/health', validate: assertHealthInfo });
}

/** Pack-level, not session-scoped: the knowledge pack is shared by all sessions. */
export function getSources(): Promise<SourcesData> {
  return request({ method: 'GET', path: '/sources', validate: assertSourcesData });
}

export function createSession(input: StartSessionInput): Promise<SessionState> {
  return request({
    method: 'POST',
    path: '/session',
    body: input,
    validate: assertSessionState,
  });
}

// Every session-scoped call takes sessionId as an argument. There is no
// module-level "active session".

export function getSession(sessionId: string): Promise<SessionState> {
  return request({
    method: 'GET',
    path: `/session/${encodeURIComponent(sessionId)}`,
    validate: assertSessionState,
  });
}

export function submitEvidence(
  sessionId: string,
  input: EvidenceInput,
): Promise<SessionState> {
  return request({
    method: 'POST',
    path: `/session/${encodeURIComponent(sessionId)}/evidence`,
    body: input,
    validate: assertSessionState,
  });
}

export function correctEvidence(
  sessionId: string,
  evidenceId: string,
  input: EvidenceInput,
): Promise<SessionState> {
  return request({
    method: 'POST',
    path: `/session/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(evidenceId)}`,
    body: input,
    validate: assertSessionState,
  });
}

export function deferQuestion(
  sessionId: string,
  featureId: string,
): Promise<SessionState> {
  return request({
    method: 'POST',
    path: `/session/${encodeURIComponent(sessionId)}/defer`,
    body: { featureId },
    validate: assertSessionState,
  });
}

// getTrace: added when the Trace screen is built.