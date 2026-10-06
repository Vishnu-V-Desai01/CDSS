// packages/api/src/__tests__/sources.test.ts
/**
 * Tests for /sources generation.
 *
 * Acceptance criterion: "/sources is generated from the built pack."
 * These tests verify the generation logic produces correct, traceable
 * output — not that it matches a hand-maintained list, because there
 * must not be one.
 */

import { describe, it, expect } from "vitest";
import { buildSourcesResponse } from "../sources.js";
import type { LoadedPack } from "../packLoader.js";

const mockPack: LoadedPack = {
  knowledgePackVersion: "test.1.0",
  knowledgePackHash: "sha256:abc",
  conditions: {
    PULMONARY_EMBOLISM: {
      schema_version: "1.0.0",
      condition_id: "PULMONARY_EMBOLISM",
      display_name: "Pulmonary Embolism",
      class: "CANDIDATE",
      visibility: "REPORTED",
      enabled: true,
      priors: {
        ED_UNDIFFERENTIATED_CHEST_PAIN: {
          weight: 0.04,
          citation_id: "CIT-PE-PRIOR-01",
          population: "ED chest pain",
          verification_status: "unverified",
        },
      },
      features: [
        {
          feature_id: "VS_SPO2_ROOM_AIR",
          tier: "BEDSIDE",
          dependency_group: null,
          acquisition_cost: 1,
          prerequisite: null,
          invasiveness: "NONE",
          turnaround_minutes: 1,
          verification_status: "unverified",
          states: [
            {
              value: "LT_90",
              lr: 3.0,
              derived_from: { sensitivity: 0.3, specificity: 0.9, n: 100, prevalence_in_study: 0.1 },
              citation_id: "CIT-PE-VS-02",
            },
          ],
        },
      ],
      expected_profile: [],
      dependency_groups: [],
      red_flag_links: [],
      mimics: [],
      disposition_guidance: "",
      provenance: { authors: [], clinical_reviewer: null, created: "", last_reviewed: null, review_due: null },
      verification_status: "unverified",
    } as any,
  },
  citations: {
    "CIT-PE-PRIOR-01": {
      type: "PRIMARY_STUDY",
      title: "PE Prior Study",
      authors: "Smith et al.",
      year: 2020,
      evidence_grade: "B",
      table_or_figure: "Table 1",
      extracted_by: "test",
      extracted_on: "2026-01-01",
      checked_by: null,
    },
    "CIT-PE-VS-02": {
      type: "PRIMARY_STUDY",
      title: "PE SpO2 Study",
      authors: "Jones et al.",
      year: 2021,
      evidence_grade: "A",
      table_or_figure: "Table 2",
      extracted_by: "test",
      extracted_on: "2026-01-01",
      checked_by: "reviewer",
    },
  },
  redFlags: {},
};

describe("Sources Generation", () => {
  it("includes pack version and hash", () => {
    const result = buildSourcesResponse(mockPack);
    expect(result.knowledgePackVersion).toBe("test.1.0");
    expect(result.knowledgePackHash).toBe("sha256:abc");
  });

  it("generates one entry per feature state with citation resolved", () => {
    const result = buildSourcesResponse(mockPack);
    expect(result.featureLikelihoods).toHaveLength(1);
    const entry = result.featureLikelihoods[0];
    expect(entry.featureId).toBe("VS_SPO2_ROOM_AIR");
    expect(entry.state).toBe("LT_90");
    expect(entry.lr).toBe(3.0);
    expect(entry.citation?.title).toBe("PE SpO2 Study");
    expect(entry.citation?.evidenceGrade).toBe("A");
  });

  it("includes derived_from data", () => {
    const result = buildSourcesResponse(mockPack);
    expect(result.featureLikelihoods[0].derivedFrom).toEqual({
      sensitivity: 0.3,
      specificity: 0.9,
      n: 100,
      prevalenceInStudy: 0.1,
    });
  });

  it("generates prior entries with resolved citations", () => {
    const result = buildSourcesResponse(mockPack);
    expect(result.priors).toHaveLength(1);
    expect(result.priors[0].weight).toBe(0.04);
    expect(result.priors[0].citation?.title).toBe("PE Prior Study");
  });

  it("produces deterministic ordering", () => {
    const result1 = buildSourcesResponse(mockPack);
    const result2 = buildSourcesResponse(mockPack);
    expect(result1.featureLikelihoods.map((f) => f.featureId)).toEqual(
      result2.featureLikelihoods.map((f) => f.featureId)
    );
  });
});