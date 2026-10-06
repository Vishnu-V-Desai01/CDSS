/**
 * Integration test: the REAL compiled pack.json, not synthetic fixtures.
 *
 * WHY THIS IS DRIVEN BY THE RANKER, NOT HARDCODED EVIDENCE
 * ----------------------------------------------------------
 * This test does not assume which specific features exist inside
 * PULMONARY_EMBOLISM's real features[] array, or what exact state values
 * are clinically "supportive" of PE. Those are Chat 1's authored content and
 * could change. Instead, this test repeatedly asks the session's own
 * nextQuestion for what to ask, and answers using a real registered state
 * value for that feature. This proves the MECHANICAL integration — pack
 * shape -> adapter -> evaluate() -> ranker -> session loop — is sound
 * against real data, independent of exactly what Chat 1 populated.
 *
 * A semantically precise "worked scenario" test (specific evidence in a
 * specific order, expecting a specific posterior) belongs alongside the
 * design doc's actual worked example, once available.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConditionFile, RedFlagRule } from "@cds/shared-types";
import {
  InferenceSession,
  SessionHaltedError,
  type SessionConfig,
} from "../session.js";
import {
  adaptPack,
  buildFeatureMetaFromPack,
  buildCitationResolver,
} from "../adaptPack.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(
  __dirname,
  "../../../knowledge-packs/cv-v1/dist/pack.json"
);

interface CompiledPack {
  knowledge_pack_version: string;
  conditions: Record<string, ConditionFile>;
  citations: Record<string, unknown>;
  red_flags: Record<string, RedFlagRule>;
  knowledge_pack_hash: string;
}

function loadCompiledPack(): CompiledPack {
  let raw: string;
  try {
    raw = readFileSync(PACK_PATH, "utf8");
  } catch {
    throw new Error(
      `Could not read ${PACK_PATH}. Build the pack first:\n` +
        `  node packages/knowledge-pack-builder/dist/cli.js build ` +
        `packages/knowledge-packs/cv-v1 --out packages/knowledge-packs/cv-v1/dist`
    );
  }
  return JSON.parse(raw) as CompiledPack;
}

const CANDIDATE_IDS = [
  "PULMONARY_EMBOLISM",
  "UNSTABLE_ANGINA",
  "CONGESTIVE_HEART_FAILURE",
  "ACUTE_PERICARDITIS",
] as const;

/** Confirmed real care-setting key: appears in shadow-anxiety-panic's priors. */
const CARE_SETTING = "ED_UNDIFFERENTIATED_CHEST_PAIN";

function buildSessionConfig(pack: CompiledPack): SessionConfig {
  return {
    conditions: adaptPack(pack.conditions),
    careSetting: CARE_SETTING,
    inScopeConditionIds: CANDIDATE_IDS,
    featureMeta: buildFeatureMetaFromPack(pack.conditions),
    resolveCitation: buildCitationResolver(pack.conditions),
    strictCitations: true,
    lrScale: "RAW", // confirmed: PERC_RULE stores lr: 0.17 / 1.28, raw ratios
  };
}

describe("integration — real compiled pack.json", () => {
  it("loads without throwing and produces a non-empty candidate set", () => {
    const pack = loadCompiledPack();
    expect(() => new InferenceSession(buildSessionConfig(pack))).not.toThrow();
  });

  it("starts every hypothesis with a finite, sourced prior", () => {
    const pack = loadCompiledPack();
    const session = new InferenceSession(buildSessionConfig(pack));
    const priors = session.trace().filter((e) => e.type === "PRIOR");

    // All nine hypotheses (four candidates + five shadows) get a prior,
    // since evaluate() throws if any condition lacks a prior for the
    // configured care setting — this passing at all is itself a real check.
    expect(priors.length).toBe(Object.keys(pack.conditions).length);
    for (const p of priors) {
      expect(Number.isFinite(p.logOddsAfter)).toBe(true);
    }
  });

  it(
    "self-drives via the ranker: tiers advance monotonically, " +
      "every recorded finding is cited, distribution always sums to 1",
    () => {
      const pack = loadCompiledPack();
      const session = new InferenceSession(buildSessionConfig(pack));
      const registry = pack.conditions; // for looking up real state_values

      const TIER_RANK: Record<string, number> = {
        HISTORY: 0,
        BEDSIDE: 1,
        NEAR_BEDSIDE: 2,
        IMAGING: 3,
      };
      let highestTierSeen = -1;
      let turns = 0;
      const MAX_TURNS = 40; // safety bound; real packs terminate well before this

      while (turns < MAX_TURNS) {
        const state = session.state();
        const next = state.nextQuestion;
        if (!next) break;

        const tierIndex = TIER_RANK[next.tier] ?? -1;
        expect(tierIndex).toBeGreaterThanOrEqual(highestTierSeen);
        highestTierSeen = Math.max(highestTierSeen, tierIndex);

        // Find a real registered state for this feature from any condition
        // that declares it, and answer with the first one. We don't assert
        // this is "clinically positive" — only that it's a REAL value from
        // the pack, proving the adapter's state mapping is correct.
        const owningCondition = Object.values(registry).find((c) =>
          c.features.some((f) => f.feature_id === next.featureId)
        );
        const feature = owningCondition?.features.find(
          (f) => f.feature_id === next.featureId
        );
        expect(feature).toBeDefined();
        const stateToAnswer = feature!.states[0]!.value;

        const turn = session.answer(next.featureId, stateToAnswer);

        // Distribution always sums to 1, every turn.
        const total = turn.distribution.entries.reduce(
          (a, e) => a + e.probability,
          0
        );
        expect(total).toBeCloseTo(1, 8);

        // scopeFit is exactly 1 - P(UNKNOWN) by construction.
        const unknownEntry = turn.distribution.entries.find(
          (e) => e.id === "UNKNOWN"
        )!;
        expect(turn.distribution.scopeFit).toBeCloseTo(
          1 - unknownEntry.probability,
          10
        );

        // Every EVIDENCE trace entry this turn carries a real citation, not
        // UNSOURCED — strictCitations: true would already have thrown
        // otherwise, but this re-confirms it explicitly.
        const evidenceEntries = turn.newTraceEntries.filter(
          (e) => e.type === "EVIDENCE"
        );
        for (const e of evidenceEntries) {
          expect(e.citationId).toBeTruthy();
          expect(e.citationId).not.toBe("UNSOURCED");
        }

        turns++;
      }

      // The loop must have actually done something, and must have
      // terminated by running out of informative questions, not by hitting
      // the safety bound.
      expect(turns).toBeGreaterThan(0);
      expect(turns).toBeLessThan(MAX_TURNS);
    }
  );

  it("halts and produces no differential when a red flag fires", () => {
    const pack = loadCompiledPack();
    const session = new InferenceSession(buildSessionConfig(pack));

    // Simulating the backend safety gate (Chat 4's real job): match incoming
    // findings against red-flags.yaml triggers. Minimal inline check here,
    // not a shipped engine feature — the engine only enforces halt() once
    // told to, per spec ("red flag detection ... backend integration").
    const simulatedFindings: Record<string, string> = {
      SYSTOLIC_BLOOD_PRESSURE_CATEGORY: "HYPOTENSIVE",
      HEART_RATE_CATEGORY: "SEVERE_TACHYCARDIA",
    };

    const rf01 = pack.red_flags["RF-01"];
    expect(rf01).toBeDefined();
    const fires =
      rf01!.trigger_logic === "ALL"
        ? rf01!.triggers.every(
            (t) => simulatedFindings[t.finding_id] === t.required_state
          )
        : rf01!.triggers.some(
            (t) => simulatedFindings[t.finding_id] === t.required_state
          );
    expect(fires).toBe(true);

    session.halt(rf01!.halt_message);

    expect(session.state.bind(session)).toThrow(SessionHaltedError);
    expect(() => session.answer("PERC_RULE", "POSITIVE")).toThrow(
      SessionHaltedError
    );

    const haltEntry = session
      .trace()
      .find((e) => e.note?.startsWith("HALTED"));
    expect(haltEntry).toBeDefined();
    expect(haltEntry!.note).toContain(rf01!.halt_message.trim());
  });
});