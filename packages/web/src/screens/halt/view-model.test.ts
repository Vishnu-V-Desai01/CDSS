import { describe, it, expect } from 'vitest';
import { toHaltView, type HaltSource } from './view-model';

const source: HaltSource = {
  metadata: {
    sessionId: 's-1',
    createdAt: '2026-10-05T14:00:00.000Z',
    careSetting: 'ED_UNDIFFERENTIATED_CHEST_PAIN',
    patientAge: 60,
    patientSex: 'MALE',
  },
  halt: {
    primaryRule: 'RF-01',
    rules: [
      {
        ruleId: 'RF-01',
        displayName: 'Haemodynamic Collapse',
        clinicalRationale: 'Systolic BP low with severe tachycardia.\n',
        haltMessage: 'Haemodynamic collapse detected. Initiate resuscitation.\n',
        triggers: [
          {
            findingId: 'SYSTOLIC_BLOOD_PRESSURE_CATEGORY',
            requiredState: 'HYPOTENSIVE',
            description: 'Systolic BP < 90 mmHg',
            observedState: 'HYPOTENSIVE',
            matched: true,
            sourceEvidence: [
              { evidenceId: 'e-sbp', featureId: 'VS_SBP' },
              { evidenceId: 'e-dbp', featureId: 'VS_DBP' },
            ],
          },
          {
            findingId: 'HEART_RATE_CATEGORY',
            requiredState: 'SEVERE_TACHYCARDIA',
            description: 'Heart rate > 130 bpm',
            observedState: null,
            matched: false,
            sourceEvidence: [],
          },
        ],
      },
    ],
  },
  answeredEvidence: [
    { evidenceId: 'e-sbp', featureId: 'VS_SBP', value: '84', rawValue: 84, turn: 3, isVital: true, prompt: null, stateValues: null, tier: null },
    { evidenceId: 'e-dbp', featureId: 'VS_DBP', value: '50', rawValue: 50, turn: 4, isVital: true, prompt: null, stateValues: null, tier: null },
  ],
};

describe('toHaltView', () => {
  const view = toHaltView(source, new Date('2026-10-05T14:05:00Z'));

  it('maps the rule, its triggers and the readings to correct', () => {
    const rule = view.rules[0]!;
    expect(rule.ruleId).toBe('RF-01');
    expect(rule.isPrimary).toBe(true);
    expect(rule.triggers[0]!.requiredLabel).toBe('Hypotensive');
    expect(rule.triggers[0]!.observedLabel).toBe('Hypotensive');
    expect(rule.triggers[0]!.readings.map((r) => r.valueLabel)).toEqual(['84 mmHg', '50 mmHg']);
    expect(rule.triggers[0]!.readings[0]!.input).toEqual({ kind: 'number', unit: 'mmHg' });
  });

  it('serves the guidance as authored, only trimmed', () => {
    const rule = view.rules[0]!;
    expect(rule.guidance).toBe('Haemodynamic collapse detected. Initiate resuscitation.');
    expect(rule.rationale).toBe('Systolic BP low with severe tachycardia.');
  });

  it('shows an unrecorded or unmatched trigger honestly', () => {
    const t = view.rules[0]!.triggers[1]!;
    expect(t.matched).toBe(false);
    expect(t.observedLabel).toBeNull();
    expect(t.readings).toEqual([]);
  });

  it('contains no probability, percentage or distribution anywhere', () => {
    expect(JSON.stringify(view)).not.toMatch(/%|probab|distribution/i);
  });
});