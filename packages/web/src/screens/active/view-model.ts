/**
 * Formatting and mapping only. Every probability, rank and score arrives from
 * the server; nothing here sums, subtracts, normalises, sorts or thresholds a
 * clinical value. Lists are rendered in the order received.
 */
import type { SessionState, AnsweredEvidence, PendingQuestion } from '@cds/session-store';
import { CARE_SETTING_LABELS, SEX_LABELS } from '../intake/view-model';
import type { EvidenceInput, EvidenceSource } from '../../api/endpoints';
import type {
  ActiveBodyView,
  AnsweredItemView,
  AwaitingBodyView,
  BodyView,
  ConnectionView,
  DeferredItemView,
  DifferentialRowView,
  DifferentialView,
  HeaderView,
  LastUpdateView,
  Option,
  QuestionView,
  RedFlagGroupView,
  VitalFieldView,
  VitalInputView,
} from './ActiveSession';

export interface ActiveView {
  header: HeaderView;
  connection: ConnectionView;
  body: BodyView;
}

// ---------------------------------------------------------------------------
// Wording owned by the client (formatting only)
// ---------------------------------------------------------------------------

// Hypothesis names. Five entries: the four named conditions and UNKNOWN.
const HYPOTHESIS_NAMES: Record<string, string> = {
  PULMONARY_EMBOLISM: 'Pulmonary Embolism',
  UNSTABLE_ANGINA: 'Unstable Angina',
  CONGESTIVE_HEART_FAILURE: 'Congestive Heart Failure',
  ACUTE_PERICARDITIS: 'Acute Pericarditis',
  UNKNOWN: 'Unknown — not one of the four named conditions',
};

const TIER_LABELS: Record<string, string> = {
  HISTORY: 'History',
  BEDSIDE: 'Bedside',
  NEAR_BEDSIDE: 'Near-bedside',
  IMAGING: 'Imaging',
};

interface VitalDef {
  label: string;
  unit: string;
  input: VitalInputView;
}

// Vitals are not in the features registry, so their labels and units live
// here. Binning (normal / tachycardic / ...) is done by the server only.
// PROVISIONAL: the mental-status options are not defined in the pack.
const MENTAL_STATUS_OPTIONS: Option[] = [
  { value: 'ALERT', label: 'Alert' },
  { value: 'CONFUSED', label: 'Confused' },
  { value: 'LETHARGIC', label: 'Lethargic' },
  { value: 'UNRESPONSIVE', label: 'Unresponsive' },
];

const VITALS: Record<string, VitalDef> = {
  VS_HEART_RATE: { label: 'Heart rate', unit: 'bpm', input: { kind: 'number' } },
  VS_RESP_RATE: { label: 'Respiratory rate', unit: 'breaths/min', input: { kind: 'number' } },
  VS_SBP: { label: 'Systolic blood pressure', unit: 'mmHg', input: { kind: 'number' } },
  VS_DBP: { label: 'Diastolic blood pressure', unit: 'mmHg', input: { kind: 'number' } },
  VS_SPO2_ROOM_AIR: { label: 'Oxygen saturation (room air)', unit: '%', input: { kind: 'number' } },
  VS_TEMPERATURE: { label: 'Temperature', unit: '°C', input: { kind: 'number' } },
  EX_MENTAL_STATUS: {
    label: 'Mental status',
    unit: '',
    input: { kind: 'select', options: MENTAL_STATUS_OPTIONS },
  },
};

// Display and submission order of the vitals form. A fixed layout, not a ranking.
const VITAL_ORDER: string[] = [
  'VS_HEART_RATE',
  'VS_RESP_RATE',
  'VS_SBP',
  'VS_DBP',
  'VS_SPO2_ROOM_AIR',
  'VS_TEMPERATURE',
  'EX_MENTAL_STATUS',
];

export function sentenceCase(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toOptions(values: readonly string[]): Option[] {
  return values.map((value) => ({ value, label: sentenceCase(value) }));
}

function percentLabel(probability: number): string {
  const pct = probability * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-GB');
}

// ---------------------------------------------------------------------------
// Evidence payloads
// ---------------------------------------------------------------------------

function sourceForTier(tier: string | null): EvidenceSource {
  return tier === 'HISTORY' ? 'PATIENT_REPORTED' : 'OBSERVED';
}

/** A categorical answer. The source follows the question's tier. */
export function answerInput(featureId: string, value: string, tier: string | null): EvidenceInput {
  return {
    featureId,
    value,
    source: sourceForTier(tier),
    observedAt: new Date().toISOString(),
    observerConfidence: 'HIGH',
  };
}

export type InputParse = { ok: true; input: EvidenceInput } | { ok: false; error: string };

/** A vital. The raw number goes to the server, which does the binning. */
export function vitalInput(featureId: string, draft: string): InputParse {
  const def = VITALS[featureId];
  const text = draft.trim();
  if (text === '') return { ok: false, error: 'Required.' };

  if (def && def.input.kind === 'select') {
    return {
      ok: true,
      input: {
        featureId,
        value: text,
        source: 'OBSERVED',
        observedAt: new Date().toISOString(),
        observerConfidence: 'HIGH',
      },
    };
  }

  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter a positive number.' };
  return {
    ok: true,
    input: {
      featureId,
      value: String(n),
      rawValue: n,
      source: 'MEASURED',
      observedAt: new Date().toISOString(),
      observerConfidence: 'HIGH',
    },
  };
}

export function validateVitalDrafts(
  featureIds: readonly string[],
  drafts: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const id of featureIds) {
    const parsed = vitalInput(id, drafts[id] ?? '');
    if (!parsed.ok) errors[id] = parsed.error;
  }
  return errors;
}

export function correctionInput(item: AnsweredEvidence, draft: string): InputParse {
  if (item.isVital) return vitalInput(item.featureId, draft);
  return { ok: true, input: answerInput(item.featureId, draft, item.tier) };
}

/** The vitals still missing, in the fixed form order. */
export function missingVitalIds(missing: readonly string[]): string[] {
  const known = VITAL_ORDER.filter((id) => missing.includes(id));
  const unknown = missing.filter((id) => !VITAL_ORDER.includes(id));
  return [...known, ...unknown];
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function toHeader(session: SessionState): HeaderView {
  const m = session.metadata;
  const sex = (SEX_LABELS as Record<string, string>)[m.patientSex] ?? m.patientSex;
  const setting = (CARE_SETTING_LABELS as Record<string, string>)[m.careSetting] ?? m.careSetting;
  return {
    sessionId: m.sessionId,
    summary: `${m.patientAge} y · ${sex} · ${setting}`,
    turnLabel: `Turn ${session.turn}`,
    statusLabel: session.minimumSafetySet.complete ? 'Active' : 'Awaiting vitals',
    traceHref: `/session/${m.sessionId}/trace`,
    sourcesHref: `/sources?session=${m.sessionId}`,
  };
}

function toVitalField(featureId: string): VitalFieldView {
  const def = VITALS[featureId];
  if (!def) return { featureId, label: featureId, unit: '', input: { kind: 'number' } };
  return { featureId, label: def.label, unit: def.unit, input: def.input };
}

function toAwaiting(session: SessionState): AwaitingBodyView {
  return {
    mode: 'awaiting-vitals',
    vitalFields: missingVitalIds(session.minimumSafetySet.missing).map(toVitalField),
    submittedProgress: null,
  };
}

function toDifferential(session: SessionState): DifferentialView {
  const d = session.distribution;
  const move = session.lastMovement;
  // Previous values are only meaningful alongside the distribution they led to.
  const before = move && move.after !== null && move.before !== null ? move.before : null;
  const previous = new Map<string, number>(before ? before.map((e) => [e.id, e.probability]) : []);

  const rows: DifferentialRowView[] = (d ? d.entries : []).map((e) => {
    const now = percentLabel(e.probability);
    const prevP = previous.get(e.id);
    const prevLabel = prevP === undefined ? null : percentLabel(prevP);
    const moved = prevLabel !== null && prevLabel !== now;
    return {
      id: e.id,
      name: HYPOTHESIS_NAMES[e.id] ?? e.id,
      percentLabel: now,
      barPercent: e.probability * 100,
      previousBarPercent: moved && prevP !== undefined ? prevP * 100 : null,
      movementLabel: moved ? `${prevLabel} → ${now}` : null,
      isUnknown: e.id === 'UNKNOWN',
    };
  });

  return {
    rows,
    contextLine: d
      ? `Share of probability on the four named conditions: ${percentLabel(d.scopeFit)}`
      : '',
  };
}

function toLastUpdate(session: SessionState): LastUpdateView | null {
  const move = session.lastMovement;
  // No earlier distribution means nothing moved; show the empty state instead.
  if (!move || move.before === null) return null;
  const answered = session.answeredEvidence.find((a) => a.evidenceId === move.evidenceId);
  const item = answered ? toAnsweredItem(answered) : null;
  const label = item ? item.prompt : (move.featureId ?? 'Evidence');
  const value = item ? item.valueLabel : sentenceCase(move.value ?? '');
  const was = move.kind === 'EVIDENCE_CORRECTED' && move.previousValue ? ` (was ${sentenceCase(move.previousValue)})` : '';

  return {
    title: `${label} → ${value}${was}`,
    whenLabel: `Turn ${move.turn} · ${timeLabel(new Date(move.at))}`,
    citations: move.citations.map((c) => ({
      key: `${c.hypothesisId}|${c.citationId}`,
      label:
        c.citationId === 'UNKNOWN_BASIS'
          ? 'Basis for Unknown (not itemised)'
          : `Citation ${c.citationId} · ${HYPOTHESIS_NAMES[c.hypothesisId] ?? c.hypothesisId}`,
      href: `/sources?session=${session.metadata.sessionId}#${encodeURIComponent(c.citationId)}`,
    })),
    traceHref: `/session/${session.metadata.sessionId}/trace`,
  };
}

function toQuestion(session: SessionState): QuestionView | null {
  const q = session.nextQuestion;
  if (!q) return null;
  return {
    featureId: q.featureId,
    prompt: q.prompt,
    tierLabel: TIER_LABELS[q.tier] ?? q.tier,
    costLabel: `Cost ${q.cost} of 10`,
    impactLabel: `Impact ${q.eigBits.toFixed(2)} bits`,
    options: toOptions(q.stateValues),
  };
}

function toDeferred(p: PendingQuestion): DeferredItemView {
  const then = `Impact when deferred ${p.impactAtDeferral.toFixed(2)} bits`;
  const now = p.currentImpact === null ? '' : ` · now ${p.currentImpact.toFixed(2)} bits`;
  return {
    featureId: p.featureId,
    prompt: p.prompt,
    tierLabel: TIER_LABELS[p.tier] ?? p.tier,
    costLabel: `Cost ${p.cost} of 10`,
    impactLabel: `${then}${now}`,
    options: toOptions(p.stateValues),
  };
}

function toRedFlagGroups(session: SessionState): RedFlagGroupView[] {
  return session.redFlagChecks.map((c) => ({
    ruleId: c.ruleId,
    ruleName: c.displayName,
    findings: c.missingFindings.map((f) => ({
      featureId: f.featureId,
      prompt: f.prompt,
      options: toOptions(f.stateValues),
      answerable: f.answerable,
    })),
  }));
}

export function toAnsweredItem(e: AnsweredEvidence): AnsweredItemView {
  if (e.isVital) {
    const def = VITALS[e.featureId];
    if (def && def.input.kind === 'select') {
      const opt = def.input.options.find((o) => o.value === e.value);
      return {
        evidenceId: e.evidenceId,
        featureId: e.featureId,
        prompt: def.label,
        valueLabel: opt ? opt.label : sentenceCase(e.value),
        input: { kind: 'options', options: def.input.options },
        isVital: true,
      };
    }
    const unit = def ? def.unit : '';
    return {
      evidenceId: e.evidenceId,
      featureId: e.featureId,
      prompt: def ? def.label : e.featureId,
      valueLabel:
        unit === '%'
          ? `${e.rawValue ?? e.value}%`
          : `${e.rawValue ?? e.value} ${unit}`.trim(),
      input: { kind: 'number', unit },
      isVital: true,
    };
  }
  return {
    evidenceId: e.evidenceId,
    featureId: e.featureId,
    prompt: e.prompt ?? e.featureId,
    valueLabel: sentenceCase(e.value),
    input: { kind: 'options', options: toOptions(e.stateValues ?? []) },
    isVital: false,
  };
}

function toActive(session: SessionState): ActiveBodyView {
  return {
    mode: 'active',
    differential: toDifferential(session),
    lastUpdate: toLastUpdate(session),
    question: toQuestion(session),
    noQuestionMessage: 'No remaining question meets the information threshold.',
    deferred: session.pending.map(toDeferred),
    redFlagGroups: toRedFlagGroups(session),
    answered: session.answeredEvidence.map(toAnsweredItem),
  };
}

export function toActiveView(session: SessionState, lastOkAt: Date): ActiveView {
  const awaiting = !session.minimumSafetySet.complete || session.distribution === null;
  return {
    header: toHeader(session),
    connection: { ok: true, label: `Connected · updated ${timeLabel(lastOkAt)}` },
    body: awaiting ? toAwaiting(session) : toActive(session),
  };
}