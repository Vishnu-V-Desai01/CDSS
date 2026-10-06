import { describe, expect, it } from "vitest";
import {
  InferenceSession,
  SessionHaltedError,
  MissingCitationError,
  type SessionConfig,
} from "../session.js";

/**
 * Fixture: two in-scope conditions plus one shadow, so scope fit is
 * meaningful. LRs are RAW here, matching the evaluate() fixture shape.
 */
function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    conditions: [
      {
        id: "PE",
        priors: { ED: 0.3 },
        features: [
          { id: "PLEURITIC_PAIN", dependencyGroup: null, lrs: { PRESENT: 2.0, ABSENT: 0.6 } },
          { id: "TACHYCARDIA", dependencyGroup: null, lrs: { PRESENT: 1.8, ABSENT: 0.7 } },
          { id: "D_DIMER", dependencyGroup: null, lrs: { PRESENT: 2.5, ABSENT: 0.15 } },
          { id: "CT_ANGIOGRAM", dependencyGroup: null, lrs: { PRESENT: 20.0, ABSENT: 0.05 } },
        ],
        expectedProfile: [
          { featureId: "PLEURITIC_PAIN", expectedStates: ["PRESENT"], weight: 1, hallmark: false },
        ],
        dependencyGroups: {},
      },
      {
        id: "CHF",
        priors: { ED: 0.4 },
        features: [
          { id: "PLEURITIC_PAIN", dependencyGroup: null, lrs: { PRESENT: 0.5, ABSENT: 1.4 } },
          { id: "TACHYCARDIA", dependencyGroup: null, lrs: { PRESENT: 1.2, ABSENT: 0.9 } },
          { id: "D_DIMER", dependencyGroup: null, lrs: { PRESENT: 0.7, ABSENT: 1.3 } },
          { id: "CT_ANGIOGRAM", dependencyGroup: null, lrs: { PRESENT: 0.1, ABSENT: 1.5 } },
        ],
        expectedProfile: [
          { featureId: "TACHYCARDIA", expectedStates: ["PRESENT"], weight: 1, hallmark: false },
        ],
        dependencyGroups: {},
      },
      {
        id: "SHADOW_ANXIETY",
        priors: { ED: 0.3 },
        features: [
          { id: "PLEURITIC_PAIN", dependencyGroup: null, lrs: { PRESENT: 0.8, ABSENT: 1.1 } },
          { id: "TACHYCARDIA", dependencyGroup: null, lrs: { PRESENT: 1.5, ABSENT: 0.8 } },
          { id: "D_DIMER", dependencyGroup: null, lrs: { PRESENT: 0.4, ABSENT: 1.4 } },
          { id: "CT_ANGIOGRAM", dependencyGroup: null, lrs: { PRESENT: 0.05, ABSENT: 1.6 } },
        ],
        expectedProfile: [
          { featureId: "PLEURITIC_PAIN", expectedStates: ["ABSENT"], weight: 1, hallmark: false },
        ],
        dependencyGroups: {},
      },
    ],
    careSetting: "ED",
    inScopeConditionIds: ["PE", "CHF"],
    featureMeta: {
      PLEURITIC_PAIN: { tier: "HISTORY", cost: 1 },
      TACHYCARDIA: { tier: "BEDSIDE", cost: 1 },
      D_DIMER: { tier: "BEDSIDE", cost: 3 },
      CT_ANGIOGRAM: { tier: "IMAGING", cost: 10 },
    },
    resolveCitation: (featureId, state) => `${featureId}_${state}_CITATION`,
    lrScale: "RAW",
    ...overrides,
  };
}

/** Deterministic shuffle so failures are reproducible. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const EVIDENCE: Array<[string, string]> = [
  ["PLEURITIC_PAIN", "PRESENT"],
  ["TACHYCARDIA", "PRESENT"],
  ["D_DIMER", "PRESENT"],
];

describe("ACCEPTANCE 1 — order independence", () => {
  it("produces an identical posterior across 10 shuffles of the same evidence", () => {
    const reference = new InferenceSession(makeConfig());
    for (const [f, s] of EVIDENCE) reference.answer(f, s);
    const expected = reference.state().distribution.entries;

    for (let seed = 1; seed <= 10; seed++) {
      const session = new InferenceSession(makeConfig());
      for (const [f, s] of seededShuffle(EVIDENCE, seed)) session.answer(f, s);

      const actual = session.state().distribution.entries;
      // Bit-identical, not merely close: addition is commutative and the
      // engine is deterministic, so there is no tolerance to allow.
      expect(actual).toEqual(expected);
    }
  });

  it("keeps the reported distribution summing to 1", () => {
    const session = new InferenceSession(makeConfig());
    for (const [f, s] of EVIDENCE) session.answer(f, s);

    const total = session
      .state()
      .distribution.entries.reduce((acc, e) => acc + e.probability, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("ACCEPTANCE 2 — trace completeness", () => {
  it("reconstructs the engine's log-odds exactly from the trace", () => {
    const session = new InferenceSession(makeConfig());
    for (const [f, s] of EVIDENCE) session.answer(f, s);

    const report = session.verifyTrace();
    expect(report.complete).toBe(true);
    expect(report.mismatches).toHaveLength(0);
  });

  it("attaches a source to every evidence entry", () => {
    const session = new InferenceSession(makeConfig());
    for (const [f, s] of EVIDENCE) session.answer(f, s);

    const evidenceEntries = session
      .trace()
      .filter((e) => e.type === "EVIDENCE");
    expect(evidenceEntries.length).toBeGreaterThan(0);
    for (const e of evidenceEntries) {
      expect(e.citationId).toBeTruthy();
      expect(e.citationId).not.toBe("UNSOURCED");
    }
  });

  it("refuses to record a finding with no resolvable citation", () => {
    const session = new InferenceSession(
      makeConfig({ resolveCitation: () => null })
    );
    expect(() => session.answer("PLEURITIC_PAIN", "PRESENT")).toThrow(
      MissingCitationError
    );
  });

  it("records UNSOURCED and flags the session when strictness is waived", () => {
    const session = new InferenceSession(
      makeConfig({ resolveCitation: () => null, strictCitations: false })
    );
    const turn = session.answer("PLEURITIC_PAIN", "PRESENT");

    expect(turn.citationsComplete).toBe(false);
    expect(
      session.trace().some((e) => e.citationId === "UNSOURCED")
    ).toBe(true);
  });

  it("seeds a prior entry for every hypothesis", () => {
    const session = new InferenceSession(makeConfig());
    const priors = session.trace().filter((e) => e.type === "PRIOR");
    expect(priors.map((e) => e.hypothesisId).sort()).toEqual([
      "CHF",
      "PE",
      "SHADOW_ANXIETY",
    ]);
  });
});

describe("ACCEPTANCE 3 — deferral equivalence", () => {
  it("matches in-sequence answering when a question is deferred then answered", () => {
    const inSequence = new InferenceSession(makeConfig());
    for (const [f, s] of EVIDENCE) inSequence.answer(f, s);

    const withDeferral = new InferenceSession(makeConfig());
    withDeferral.defer("TACHYCARDIA");
    withDeferral.answer("PLEURITIC_PAIN", "PRESENT");
    withDeferral.answer("D_DIMER", "PRESENT");
    withDeferral.answer("TACHYCARDIA", "PRESENT"); // answered late

    expect(withDeferral.state().distribution.entries).toEqual(
      inSequence.state().distribution.entries
    );
  });

  it("clears a question from the pending queue once answered", () => {
    const session = new InferenceSession(makeConfig());
    session.defer("D_DIMER");
    expect(session.state().pending.map((p) => p.featureId)).toContain(
      "D_DIMER"
    );

    session.answer("D_DIMER", "PRESENT");
    expect(session.state().pending.map((p) => p.featureId)).not.toContain(
      "D_DIMER"
    );
  });

  it("keeps a deferred question scored and answerable", () => {
    const session = new InferenceSession(makeConfig());
    const turn = session.defer("D_DIMER");

    const pending = turn.pending.find((p) => p.featureId === "D_DIMER")!;
    expect(pending.impactAtDeferral).toBeGreaterThan(0);
    expect(pending.currentImpact).toBeGreaterThan(0);
  });
});

describe("ACCEPTANCE 4 — scope fit", () => {
  it("equals the posterior mass on in-scope conditions", () => {
    const session = new InferenceSession(makeConfig());
    session.answer("PLEURITIC_PAIN", "PRESENT");

    const { entries, scopeFit } = session.state().distribution;
    const inScopeMass = entries
      .filter((e) => e.id !== "UNKNOWN")
      .reduce((acc, e) => acc + e.probability, 0);

    expect(scopeFit).toBeCloseTo(inScopeMass, 10);
  });

  it("falls when evidence favours a shadow condition", () => {
    const before = new InferenceSession(makeConfig()).state().distribution
      .scopeFit;

    // D-dimer ABSENT argues against PE and mildly for the shadow.
    const session = new InferenceSession(makeConfig());
    session.answer("D_DIMER", "ABSENT");

    expect(session.state().distribution.scopeFit).toBeLessThan(before);
  });
});

describe("ACCEPTANCE 5 — question ranking respects tiers", () => {
  it("offers history before bedside before imaging", () => {
    const session = new InferenceSession(makeConfig());

    expect(session.state().nextQuestion?.tier).toBe("HISTORY");
    session.answer("PLEURITIC_PAIN", "PRESENT");

    expect(session.state().nextQuestion?.tier).toBe("BEDSIDE");
    session.answer("TACHYCARDIA", "PRESENT");
    session.answer("D_DIMER", "PRESENT");

    expect(session.state().nextQuestion?.tier).toBe("IMAGING");
  });

  it("never offers imaging while an informative history question remains", () => {
    const session = new InferenceSession(makeConfig());
    const next = session.state().nextQuestion!;

    expect(next.tier).not.toBe("IMAGING");
    expect(next.featureId).toBe("PLEURITIC_PAIN");
  });

  it("attaches an impact score to the offered question", () => {
    const session = new InferenceSession(makeConfig());
    const next = session.state().nextQuestion!;

    expect(next.eigBits).toBeGreaterThan(0);
    expect(next.value).toBeCloseTo(next.eigBits / next.cost, 12);
  });
});

describe("ACCEPTANCE 6 — halt", () => {
  it("produces no differential once halted", () => {
    const session = new InferenceSession(makeConfig());
    session.answer("PLEURITIC_PAIN", "PRESENT");
    session.halt("RED_FLAG: haemodynamic instability");

    expect(() => session.state()).toThrow(SessionHaltedError);
    expect(() => session.answer("TACHYCARDIA", "PRESENT")).toThrow(
      SessionHaltedError
    );
    expect(() => session.defer("D_DIMER")).toThrow(SessionHaltedError);
  });

  it("retains the trace and the halt reason after halting", () => {
    const session = new InferenceSession(makeConfig());
    session.answer("PLEURITIC_PAIN", "PRESENT");
    session.halt("RED_FLAG: haemodynamic instability");

    const trace = session.trace();
    expect(trace.some((e) => e.note?.startsWith("HALTED"))).toBe(true);
    expect(trace.filter((e) => e.type === "EVIDENCE").length).toBeGreaterThan(0);
  });
});

describe("evidential completeness", () => {
  it("rises as evidence is gathered", () => {
    const session = new InferenceSession(makeConfig());
    const atStart = session.state().evidentialCompleteness;

    session.answer("PLEURITIC_PAIN", "PRESENT");
    session.answer("D_DIMER", "PRESENT");

    expect(session.state().evidentialCompleteness).toBeGreaterThanOrEqual(
      atStart
    );
  });

  it("is reported separately and never alters the posterior", () => {
    const withDeferral = new InferenceSession(makeConfig());
    withDeferral.defer("D_DIMER");
    withDeferral.answer("PLEURITIC_PAIN", "PRESENT");

    const withoutDeferral = new InferenceSession(makeConfig());
    withoutDeferral.answer("PLEURITIC_PAIN", "PRESENT");

    // Identical evidence, identical posterior — the pending question does not
    // shrink confidence.
    expect(withDeferral.state().distribution.entries).toEqual(
      withoutDeferral.state().distribution.entries
    );
    expect(withDeferral.state().evidentialCompleteness).toBeLessThan(
      withoutDeferral.state().evidentialCompleteness
    );
  });
});