import { describe, expect, it } from "vitest";
import { validatePack, buildPack } from "../build.js";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(import.meta.dirname, "..", "..", "test-fixtures", "valid-pack");

/** Copy the fixture pack to a scratch dir so each test can mutate its own copy. */
function scratchCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "cds-pack-test-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("validatePack — happy path", () => {
  it("accepts the valid fixture pack with no errors", () => {
    const result = validatePack(FIXTURE);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("warns that not all nine hypotheses are present, but does not fail", () => {
    const result = validatePack(FIXTURE);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("missing hypotheses"))).toBe(true);
  });
});

describe("validatePack — LR / sens-spec 5% tolerance check", () => {
  it("rejects a stored LR that diverges from derived_from by more than 5%", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    const content = readFileSync(path, "utf8").replace("lr: 2.33", "lr: 5.00");
    writeFileSync(path, content);

    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("HX_TEST_FEATURE.PRESENT") && e.includes("implies 2.333"))).toBe(
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts an LR within 5% of the derived_from computation", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    // 2.33 -> 2.40 is ~2.9% off the implied 2.333, inside tolerance.
    const content = readFileSync(path, "utf8").replace("lr: 2.33", "lr: 2.40");
    writeFileSync(path, content);

    const result = validatePack(dir);
    expect(result.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("validatePack — feature registry identity check", () => {
  it("rejects a condition file whose feature tier diverges from the registry", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    const content = readFileSync(path, "utf8").replace("tier: HISTORY", "tier: BEDSIDE");
    writeFileSync(path, content);

    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('tier="BEDSIDE"') && e.includes('registry says "HISTORY"'))).toBe(
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a feature_id used in a condition file but absent from the registry", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    const content = readFileSync(path, "utf8").replace(/HX_TEST_FEATURE/g, "HX_UNDECLARED_FEATURE");
    // Also patch the registry back so only the condition file's feature_id changed,
    // proving the check fires on "not in registry" specifically.
    writeFileSync(path, content);
    const registryPath = join(dir, "features.registry.yaml");
    writeFileSync(registryPath, readFileSync(join(FIXTURE, "features.registry.yaml"), "utf8"));

    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("HX_UNDECLARED_FEATURE") && e.includes("not declared in"))).toBe(
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("validatePack — citation integrity", () => {
  it("rejects a citation_id that does not resolve in citations.yaml", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    const content = readFileSync(path, "utf8").replace(/CIT-TEST-01/g, "CIT-DOES-NOT-EXIST");
    writeFileSync(path, content);
    // citations.yaml still only defines CIT-TEST-01, so every reference is now broken.

    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('citation_id "CIT-DOES-NOT-EXIST" not found'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("validatePack — §0.3 verification_status gate", () => {
  it("passes without --require-verified even though everything is unverified", () => {
    const result = validatePack(FIXTURE, { requireVerified: false });
    expect(result.ok).toBe(true);
  });

  it("fails with --require-verified because the fixture is entirely unverified", () => {
    const result = validatePack(FIXTURE, { requireVerified: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("--require-verified"))).toBe(true);
  });
});

describe("buildPack — hashing", () => {
  it("produces a stable hash regardless of top-level key order in the YAML source", () => {
    const dirA = scratchCopy();
    const dirB = scratchCopy();

    // Reorder keys in dirB's condition file: move `enabled` to just after schema_version.
    const path = join(dirB, "conditions", "pulmonary_embolism.knowledge.yaml");
    const lines = readFileSync(path, "utf8").split("\n");
    const enabledIdx = lines.findIndex((l) => l.startsWith("enabled:"));
    const enabledLine = lines[enabledIdx]!;
    lines.splice(enabledIdx, 1);
    lines.splice(1, 0, enabledLine);
    writeFileSync(path, lines.join("\n"));

    const outA = join(dirA, "dist");
    const outB = join(dirB, "dist");
    const resultA = buildPack(dirA, outA, "test.1");
    const resultB = buildPack(dirB, outB, "test.1");

    expect(resultA.report.ok).toBe(true);
    expect(resultB.report.ok).toBe(true);
    expect(resultA.hash).not.toBeNull();
    expect(resultA.hash).toBe(resultB.hash);

    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("writes no pack.json when validation fails", () => {
    const dir = scratchCopy();
    const path = join(dir, "conditions", "pulmonary_embolism.knowledge.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("lr: 2.33", "lr: 5.00"));

    const out = join(dir, "dist");
    const { report, packJsonPath, hash } = buildPack(dir, out, "test.1");

    expect(report.ok).toBe(false);
    expect(packJsonPath).toBeNull();
    expect(hash).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
