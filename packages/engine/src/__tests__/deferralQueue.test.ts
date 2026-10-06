import { describe, expect, it } from "vitest";
import {
  DeferralQueue,
  evidentialCompleteness,
  type DeferredQuestion,
} from "../deferralQueue.js";
import type { CandidateQuestion } from "../rankQuestions.js";

function discriminatorCandidate(
  featureId: string,
  strength: number,
  cost = 1
): CandidateQuestion {
  return {
    featureId,
    tier: "HISTORY",
    cost,
    hypothesisLogLrs: [
      {
        hypothesisId: "DISEASE_A",
        logLrs: { PRESENT: Math.log(strength), ABSENT: Math.log(1 / strength) },
      },
      {
        hypothesisId: "DISEASE_B",
        logLrs: { PRESENT: Math.log(1 / strength), ABSENT: Math.log(strength) },
      },
    ],
  };
}

function deferred(
  featureId: string,
  impactAtDeferral: number,
  turn = 0,
  cost = 1
): DeferredQuestion {
  return {
    featureId,
    tier: "HISTORY",
    cost,
    impactAtDeferral,
    deferredAtTurn: turn,
  };
}

const EVEN_PRIOR = [
  { id: "DISEASE_A", logOdds: 0 },
  { id: "DISEASE_B", logOdds: 0 },
];

describe("DeferralQueue — defer and resolve", () => {
  it("records a skipped question with its impact score", () => {
    const q = new DeferralQueue();
    q.defer(deferred("PLEURITIC_PAIN", 0.42, 3));

    const pending = q.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.impactAtDeferral).toBeCloseTo(0.42, 12);
    expect(pending[0]!.deferredAtTurn).toBe(3);
  });

  it("preserves the original impact score when re-deferred", () => {
    const q = new DeferralQueue();
    q.defer(deferred("PLEURITIC_PAIN", 0.42, 3));
    q.defer(deferred("PLEURITIC_PAIN", 0.11, 7));

    expect(q.size).toBe(1);
    expect(q.pending()[0]!.impactAtDeferral).toBeCloseTo(0.42, 12);
    expect(q.pending()[0]!.deferredAtTurn).toBe(3);
  });

  it("resolves a deferred question and reports that it did", () => {
    const q = new DeferralQueue();
    q.defer(deferred("PLEURITIC_PAIN", 0.42));

    expect(q.resolve("PLEURITIC_PAIN")).toBe(true);
    expect(q.size).toBe(0);
    expect(q.isDeferred("PLEURITIC_PAIN")).toBe(false);
  });

  it("reports false when resolving something never deferred", () => {
    const q = new DeferralQueue();
    expect(q.resolve("NEVER_ASKED")).toBe(false);
  });

  it("exposes deferred ids in the shape the ranker's gate expects", () => {
    const q = new DeferralQueue();
    q.defer(deferred("A_FEATURE", 0.4));
    q.defer(deferred("B_FEATURE", 0.2));

    const ids = q.deferredIds();
    expect(ids.has("A_FEATURE")).toBe(true);
    expect(ids.has("B_FEATURE")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns a frozen snapshot that cannot mutate the queue", () => {
    const q = new DeferralQueue();
    q.defer(deferred("PLEURITIC_PAIN", 0.42));
    const snap = q.pending();

    expect(() => (snap as unknown as unknown[]).push({})).toThrow();
    expect(q.size).toBe(1);
  });
});

describe("DeferralQueue — rescoring", () => {
  it("reports both the historical and the current impact", () => {
    const q = new DeferralQueue();
    q.defer(deferred("FEATURE_X", 0.99));

    const rescored = q.rescore(EVEN_PRIOR, [
      discriminatorCandidate("FEATURE_X", 4.0),
    ]);

    expect(rescored[0]!.impactAtDeferral).toBeCloseTo(0.99, 12);
    expect(rescored[0]!.currentImpact).toBeGreaterThan(0);
    // The stored score was arbitrary; the current one is computed.
    expect(rescored[0]!.currentImpact).not.toBeCloseTo(0.99, 3);
  });

  it("shows current impact falling as belief becomes decided", () => {
    const q = new DeferralQueue();
    q.defer(deferred("FEATURE_X", 0.9));
    const candidates = [discriminatorCandidate("FEATURE_X", 4.0)];

    const openMinded = q.rescore(EVEN_PRIOR, candidates)[0]!.currentImpact!;
    const nearlyCertain = q.rescore(
      [
        { id: "DISEASE_A", logOdds: 6 },
        { id: "DISEASE_B", logOdds: -6 },
      ],
      candidates
    )[0]!.currentImpact!;

    expect(nearlyCertain).toBeLessThan(openMinded);
  });

  it("sorts by current impact, not by the score at deferral", () => {
    const q = new DeferralQueue();
    q.defer(deferred("LOOKED_BIG", 9.0)); // large historical score
    q.defer(deferred("LOOKS_BIG_NOW", 0.01)); // small historical score

    const rescored = q.rescore(EVEN_PRIOR, [
      discriminatorCandidate("LOOKED_BIG", 1.2), // weak now
      discriminatorCandidate("LOOKS_BIG_NOW", 9.0), // strong now
    ]);

    expect(rescored[0]!.featureId).toBe("LOOKS_BIG_NOW");
  });

  it("marks impact null for a question absent from the candidate set", () => {
    const q = new DeferralQueue();
    q.defer(deferred("REMOVED_FROM_PACK", 0.5));

    const rescored = q.rescore(EVEN_PRIOR, []);
    expect(rescored[0]!.currentImpact).toBeNull();
    expect(rescored[0]!.currentValue).toBeNull();
  });

  it("sums pending information across the queue", () => {
    const q = new DeferralQueue();
    q.defer(deferred("FEATURE_X", 0));
    q.defer(deferred("FEATURE_Y", 0));

    const candidates = [
      discriminatorCandidate("FEATURE_X", 4.0),
      discriminatorCandidate("FEATURE_Y", 4.0),
    ];
    const rescored = q.rescore(EVEN_PRIOR, candidates);
    const expected =
      rescored[0]!.currentImpact! + rescored[1]!.currentImpact!;

    expect(q.pendingBits(EVEN_PRIOR, candidates)).toBeCloseTo(expected, 12);
  });
});

describe("evidentialCompleteness", () => {
  it("is 1 when nothing is pending", () => {
    expect(evidentialCompleteness(2.5, 0)).toBeCloseTo(1, 12);
  });

  it("is 0 when nothing has been harvested", () => {
    expect(evidentialCompleteness(0, 1.4)).toBeCloseTo(0, 12);
  });

  it("is the harvested fraction in the mixed case", () => {
    expect(evidentialCompleteness(3, 1)).toBeCloseTo(0.75, 12);
  });

  it("is 1 when there is no information anywhere", () => {
    // Nothing gathered and nothing left to gather: complete, not undefined.
    expect(evidentialCompleteness(0, 0)).toBeCloseTo(1, 12);
  });
});