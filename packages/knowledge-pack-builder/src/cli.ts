#!/usr/bin/env node
import { validatePack, buildPack } from "./build.js";

function usage(): never {
  console.error("Usage:\n  cds-pack validate <packDir> [--require-verified]\n  cds-pack build <packDir> --out <outDir> [--version <semver>] [--require-verified]");
  process.exit(2);
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function report(errors: string[], warnings: string[]) {
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors) console.log(`  ✗ ${e}`);
  }
}

const [, , cmd, packDir, ...rest] = process.argv;

if (!cmd || !packDir) usage();

const requireVerified = hasFlag(rest, "--require-verified");

if (cmd === "validate") {
  const result = validatePack(packDir, { requireVerified });
  report(result.errors, result.warnings);
  console.log(result.ok ? `\n✓ ${packDir} is valid.` : `\n✗ ${packDir} FAILED validation.`);
  process.exit(result.ok ? 0 : 1);
} else if (cmd === "build") {
  const outDir = flagValue(rest, "--out");
  const version = flagValue(rest, "--version") ?? new Date().toISOString().slice(0, 10).replace(/-/g, ".") + ".0";
  if (!outDir) usage();
  const { report: rep, packJsonPath, hash } = buildPack(packDir, outDir, version, { requireVerified });
  report(rep.errors, rep.warnings);
  if (rep.ok) {
    console.log(`\n✓ Built ${packJsonPath}`);
    console.log(`  knowledge_pack_version: ${version}`);
    console.log(`  knowledge_pack_hash:    ${hash}`);
    process.exit(0);
  } else {
    console.log(`\n✗ Build FAILED, no output written.`);
    process.exit(1);
  }
} else {
  usage();
}
