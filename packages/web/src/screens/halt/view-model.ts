/**
 * Maps the halt part of a session to display text. Its input type is
 * deliberately NARROW: probabilities, questions and movements are not in it,
 * so this screen cannot show one even by mistake.
 */
import type { SessionState } from '@cds/session-store';
import { CARE_SETTING_LABELS, SEX_LABELS } from '../intake/view-model';
import { sentenceCase, toAnsweredItem } from '../active/view-model';
import type {
  ConnectionView,
  HaltHeaderView,
  HaltReadingView,
  HaltRuleView,
  HaltTriggerView,
} from './HaltScreen';

export type HaltSource = Pick<SessionState, 'metadata' | 'halt' | 'answeredEvidence'>;
type HaltInfo = NonNullable<SessionState['halt']>;
type HaltTrigger = HaltInfo['rules'][number]['triggers'][number];

export interface HaltView {
  header: HaltHeaderView;
  connection: ConnectionView;
  rules: HaltRuleView[];
}

function toHeader(source: HaltSource): HaltHeaderView {
  const m = source.metadata;
  const sex = (SEX_LABELS as Record<string, string>)[m.patientSex] ?? m.patientSex;
  const setting = (CARE_SETTING_LABELS as Record<string, string>)[m.careSetting] ?? m.careSetting;
  return {
    sessionId: m.sessionId,
    summary: `${m.patientAge} y · ${sex} · ${setting}`,
    traceHref: `/session/${m.sessionId}/trace`,
    sourcesHref: `/sources?session=${m.sessionId}`,
  };
}

function toTrigger(t: HaltTrigger, source: HaltSource): HaltTriggerView {
  const readings: HaltReadingView[] = [];
  for (const s of t.sourceEvidence) {
    const entry = source.answeredEvidence.find((a) => a.evidenceId === s.evidenceId);
    // validate.ts rejects a source that is not a current answer, so this
    // only skips a case that cannot reach here.
    if (!entry) continue;
    const item = toAnsweredItem(entry);
    readings.push({
      evidenceId: item.evidenceId,
      featureId: item.featureId,
      label: item.prompt,
      valueLabel: item.valueLabel,
      input: item.input,
    });
  }
  return {
    findingId: t.findingId,
    description: t.description,
    requiredLabel: sentenceCase(t.requiredState),
    observedLabel: t.observedState === null ? null : sentenceCase(t.observedState),
    matched: t.matched,
    readings,
  };
}

export function toHaltView(source: HaltSource, lastOkAt: Date): HaltView {
  const halt = source.halt;
  return {
    header: toHeader(source),
    connection: {
      ok: true,
      label: `Connected · updated ${lastOkAt.toLocaleTimeString('en-GB')}`,
    },
    rules: halt
      ? halt.rules.map((r) => ({
          ruleId: r.ruleId,
          ruleName: r.displayName,
          // Folded YAML text ends in a newline; the wording is otherwise as authored.
          rationale: r.clinicalRationale.trim(),
          guidance: r.haltMessage.trim(),
          isPrimary: r.ruleId === halt.primaryRule,
          triggers: r.triggers.map((t) => toTrigger(t, source)),
        }))
      : [],
  };
}