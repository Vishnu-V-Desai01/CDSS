import { describe, expect, it } from "vitest";
import {
  rankQuestions,
  InvalidCostError,
  TIER_ORDER,
  type CandidateQuestion,
  type EvidenceTier,
} from "../rankQuestions.js";
import type { HypothesisStateLogLrs } from "../informationGain.js";

/** Symmetric discriminator between two hypotheses; strength sets the EIG. */
function discriminator(strength: number): HypothesisStateLogLrs[] {
  return [
    {
      hypothesisId: "DISEASE_A",
      logLrs: { PRESENT: Math.log(strength), ABSENT: Math.log(1 / strength) },
    },
    {
      hypothesisId: "DISEASE_B",
      logLrs: { PRESENT: Math.log(1 / strength), ABSENT: Math.log(strength) },
    },
  ];
}

function candidate(
  featureId: string,
  tier: EvidenceTier,
  cost: number,
  strength: number
): CandidateQuestion {
  return { featureId, tier, cost, hypothesisLogLrs: discriminator(strength) };
}

const EVEN_PRIOR = [
  { id: "DISEASE_A", logOdds: 0 },
  { id: "DISEASE_B", logOdds: 0 },
];

describe("rankQuestions — tier constraint", () => {
  it("offers a weak history question before a strong imaging one", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("CT_ANGIOGRAM", "IMAGING", 10, 40.0), // far more informative
        candidate("PLEURITIC_PAIN", "HISTORY", 1, 1.6), // weak but earlier tier
      ],
    });

    expect(result.activeTier).toBe("HISTORY");
    expect(result.nextQuestion?.featureId).toBe("PLEURITIC_PAIN");

    // The imaging question genuinely scores higher and is still gated out.
    const ct = result.ranked.find((q) => q.featureId === "CT_ANGIOGRAM")!;
    const hx = result.ranked.find((q) => q.featureId === "PLEURITIC_PAIN")!;
    expect(ct.eigBits).toBeGreaterThan(hx.eigBits);
    expect(ct.gatedOut).toBe(true);
    expect(hx.gatedOut).toBe(false);
  });

  it("advances the gate when the earlier tier is informationally spent", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("USELESS_HISTORY", "HISTORY", 1, 1.0001), // ~0 bits
        candidate("D_DIMER", "BEDSIDE", 3, 5.0),
      ],
    });

    expect(result.activeTier).toBe("BEDSIDE");
    expect(result.nextQuestion?.featureId).toBe("D_DIMER");
    expect(result.tierRationale).toContain("HISTORY");
  });

  it("respects the full escalation path in order", () => {
    // Four tiers, not three: NEAR_BEDSIDE is distinct from BEDSIDE in the
    // real pack (e.g. D_DIMER_ELFA, BNP) — confirmed against
    // features.registry.yaml. An earlier version of this assertion assumed
    // near-bedside tests folded into BEDSIDE at higher cost; that assumption
    // was never checked against real data and was wrong.
    expect(TIER_ORDER).toEqual(["HISTORY", "BEDSIDE", "NEAR_BEDSIDE", "IMAGING"]);
  });
});

describe("rankQuestions — deferral", () => {
  it("does not re-offer a deferred question", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("SKIPPED", "HISTORY", 1, 9.0),
        candidate("ASKABLE", "HISTORY", 1, 3.0),
      ],
      deferred: new Set(["SKIPPED"]),
    });

    expect(result.nextQuestion?.featureId).toBe("ASKABLE");
  });

  it("keeps a deferred question scored for the pending queue", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("SKIPPED", "HISTORY", 1, 9.0),
        candidate("ASKABLE", "HISTORY", 1, 3.0),
      ],
      deferred: new Set(["SKIPPED"]),
    });

    const skipped = result.ranked.find((q) => q.featureId === "SKIPPED")!;
    expect(skipped.eigBits).toBeGreaterThan(0);
  });

  it("does not let a deferred question deadlock the tier gate", () => {
    // The only history question is deferred. Without this behaviour the
    // engine could never advance to bedside.
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("SKIPPED_HISTORY", "HISTORY", 1, 9.0),
        candidate("D_DIMER", "BEDSIDE", 3, 5.0),
      ],
      deferred: new Set(["SKIPPED_HISTORY"]),
    });

    expect(result.activeTier).toBe("BEDSIDE");
    expect(result.nextQuestion?.featureId).toBe("D_DIMER");
  });
});

describe("rankQuestions — value and ordering", () => {
  it("computes value as EIG divided by cost", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [candidate("FEATURE_X", "HISTORY", 4, 5.0)],
    });

    const q = result.ranked[0]!;
    expect(q.value).toBeCloseTo(q.eigBits / 4, 12);
  });

  it("prefers the cheaper of two equally informative questions", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("EXPENSIVE", "BEDSIDE", 4, 5.0),
        candidate("CHEAP", "BEDSIDE", 1, 5.0),
      ],
    });

    expect(result.nextQuestion?.featureId).toBe("CHEAP");
  });

  it("breaks exact ties deterministically by feature id", () => {
    const forward = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("ZULU", "HISTORY", 1, 4.0),
        candidate("ALPHA", "HISTORY", 1, 4.0),
      ],
    });
    const reversed = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("ALPHA", "HISTORY", 1, 4.0),
        candidate("ZULU", "HISTORY", 1, 4.0),
      ],
    });

    expect(forward.nextQuestion?.featureId).toBe("ALPHA");
    expect(reversed.nextQuestion?.featureId).toBe("ALPHA");
  });

  it("never offers an already-answered question", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        candidate("ALREADY_KNOWN", "HISTORY", 1, 9.0),
        candidate("STILL_OPEN", "HISTORY", 1, 3.0),
      ],
      answered: new Set(["ALREADY_KNOWN"]),
    });

    expect(result.ranked.map((q) => q.featureId)).not.toContain(
      "ALREADY_KNOWN"
    );
    expect(result.nextQuestion?.featureId).toBe("STILL_OPEN");
  });
});

describe("rankQuestions — edge cases", () => {
  it("returns no question when every candidate is uninformative", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [candidate("NOISE", "HISTORY", 1, 1.0)],
    });

    expect(result.nextQuestion).toBeNull();
    expect(result.activeTier).toBeNull();
    expect(result.tierRationale).toContain("uninformative");
  });

  it("returns no question when there are no candidates", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [],
    });

    expect(result.nextQuestion).toBeNull();
    expect(result.ranked).toHaveLength(0);
  });

  it("rejects a zero or negative acquisition cost", () => {
    expect(() =>
      rankQuestions({
        currentLogOdds: EVEN_PRIOR,
        candidates: [candidate("FREE_LUNCH", "HISTORY", 0, 4.0)],
      })
    ).toThrow(InvalidCostError);
  });

  it("propagates the approximation flag from information gain", () => {
    const result = rankQuestions({
      currentLogOdds: EVEN_PRIOR,
      candidates: [
        {
          featureId: "INCOHERENT_PAIR",
          tier: "HISTORY",
          cost: 1,
          hypothesisLogLrs: [
            {
              hypothesisId: "DISEASE_A",
              logLrs: { PRESENT: Math.log(2.0), ABSENT: Math.log(1.5) },
            },
            {
              hypothesisId: "DISEASE_B",
              logLrs: { PRESENT: Math.log(0.5), ABSENT: Math.log(2.0) },
            },
          ],
        },
      ],
    });

    const q = result.ranked[0]!;
    expect(q.method).toBe("APPROXIMATE_UNIFORM_BACKGROUND");
    expect(q.incoherentHypotheses).toEqual(["DISEASE_A"]);
  });
});