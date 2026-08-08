# cardiac-cds

Cardiovascular clinical decision support system. Implementation of
[`docs/CDS-CV-FOUNDATION-SPEC-v1.0.md`](docs/CDS-CV-FOUNDATION-SPEC-v1.0.md) — **read that
first, it's binding.** This README is orientation; the spec is the contract.

## Current state (2026-08-08)

Working: `schema`, `shared-types`, `knowledge-pack-builder`. The `cds-pack validate` and
`cds-pack build` CLI commands run end-to-end against a real (trimmed) PE knowledge file.
Everything else is scaffolded but empty — see the package table below.

```
npm install
npm run build            # builds all packages
npm test                 # runs vitest across all packages
npm run pack:validate    # validates packages/knowledge-packs/cv-v1
npm run pack:build       # compiles it to a hashed pack.json
```

`npm run pack:build` fails on purpose if any evidence value or prior is still
`verification_status: unverified` **when you pass `--require-verified`**; without that flag
it builds anyway, which is deliberate for development (see spec §0.3).

## Package map — who owns what

| Package | Status | Owner |
|---|---|---|
| `packages/schema` | ✅ Done. JSON Schema for condition files, citations, feature registry. | — |
| `packages/shared-types` | ✅ Done. Every enum and interface in the spec, transcribed. **Import from here, don't redeclare.** | — |
| `packages/knowledge-pack-builder` | ✅ Done. YAML→JSON compile, cross-checks, CLI. | — |
| `packages/knowledge-packs/cv-v1/conditions` | 🟡 1 of 4. Only `pulmonary_embolism.knowledge.yaml`, and it's trimmed to 5 features as a proof of pipeline — needs the full feature set per spec §1.8, plus UA, CHF, Pericarditis. | Chat 1 |
| `packages/knowledge-packs/cv-v1/shadows` | ⬜ Empty. 5 shadow files per spec §5. | Chat 2 |
| `packages/engine` | ⬜ Not scaffolded yet. Pure `evaluate()` function per spec §2.1, §3.4 (fit score), §3.3 (dependency-group discount). | Chat 3 |
| `packages/api` (safety gate) | ⬜ Not scaffolded yet. Red flags §4, minimum safety set §4.2, halt logic. | Chat 4 |
| `packages/api` (routes) | ⬜ Not scaffolded yet. Fastify, session wrapper, §2.3–2.4 request/response. | Chat 5 |
| `packages/test-harness` | ⬜ Not scaffolded yet. C1–C8 constraint tests from spec §2.6 — order-independence (C1) is the one that actually matters. | Chat 6 |

## Ground rules for every chat

1. **`shared-types` is the only place enums live.** If you need a value that isn't there,
   that's a spec amendment, not a local string literal. Six chats inventing their own
   `"BEDSIDE" | "bedside" | "Bedside"` is how this falls apart.
2. **Every `feature_id` you use must exist in `features.registry.yaml` first**, with the
   exact wording, tier, and state values you intend. Add it there before referencing it in
   a condition file. `cds-pack validate` will reject drift.
3. **Every non-1.0 `lr` needs a `citation_id`** that resolves in `citations.yaml`. If you
   don't have a real source yet, use a placeholder citation of `type: EXPERT_CONSENSUS`
   with `verification_status: unverified` — don't invent a number with no citation at all.
4. **Run `npm run pack:validate` before you consider a knowledge file done.** It catches
   LR/sens-spec transcription errors (5% tolerance) and tier/wording drift automatically.
5. **No "rule out" / "excluded" / "safe for discharge" language, anywhere** — code
   comments, error messages, UI copy, none of it. Spec §0.2.
6. If you think the spec is wrong, say so and propose an amendment against the section ID
   — don't quietly implement something different.

## What's proven so far

- Schema validation catches malformed knowledge files (missing fields, bad enums, wrong
  shapes).
- LR/sens-spec cross-check: changing a stored `lr` more than 5% away from what
  `derived_from`'s sensitivity/specificity imply fails the build, naming the exact
  feature and file.
- Feature registry identity check: a condition file that drifts a feature's `tier` (or
  uses a `feature_id` not declared in the registry) fails the build.
- Citation integrity: any `citation_id` that doesn't resolve in `citations.yaml` fails
  the build.
- Pack hashing is canonical — reordering keys in the source YAML produces an identical
  `knowledge_pack_hash`, which is what the engine API's order-independence guarantee
  (spec §2.6, C1) ultimately rests on at the data layer.
- `--require-verified` correctly refuses to build a pack containing any
  `verification_status: unverified` value.

11 unit tests cover the above in `packages/knowledge-pack-builder/src/__tests__/`.
