// packages/session-store/src/session.ts
/**
 * Session lifecycle manager.
 *
 * Adopts InferenceSession (packages/engine/src/session.ts) via
 * REPLAY-RECONSTRUCTION: every request rebuilds a fresh InferenceSession from
 * the durable, append-only evidenceLog + deferredFeatureIds, replaying
 * .answer()/.defer() in original turn order. InferenceSession holds private,
 * non-serializable internals, so it is never persisted itself.
 *
 * Derived state (distribution, questions, answered list) is recomputed.
 * History is not: `trace` is a persisted append-only event list. A correction
 * appends a new record that points at the entry it replaces.
 *
 * NAME COLLISION: @cds/engine exports its own `SessionState` (one turn's
 * read-model). This file's `SessionState` is the persisted record. The
 * engine's is aliased as EngineSessionState throughout.
 */

import { randomUUID } from "crypto";
import {
  InferenceSession,
  type SessionState as EngineSessionState,
  type SessionConfig as EngineSessionConfig,
  type TraceEntry as EngineTraceEntry,
  type ReportedDistribution,
} from "@cds/engine";
import type { FeatureRegistryFile, RedFlagRule } from "@cds/shared-types";
import {
  canonicalise,
  checkMinimumSafetySet,
  evaluateGate,
  type GateResult,
} from "@cds/safety-gate";
import type {
  SubmitEvidenceRequest,
  CorrectEvidenceRequest,
  SessionState,
  EvidenceEntry,
  SessionMetadata,
  AskableQuestion,
  PendingQuestion,
  DistributionEntry,
  RedFlagCheck,
  AnsweredEvidence,
  HaltInfo,
  TraceKind,
  TraceCitation,
  TraceRecord,
} from "./types.js";
import type { SessionStore } from "./store.js";

type ReplayStep =
  | { turn: number; kind: "answer"; featureId: string; value: string }
  | { turn: number; kind: "defer"; featureId: string };

export type BaseEngineConfig = Omit<EngineSessionConfig, "careSetting">;

interface FeatureWording {
  prompt: string;
  stateValues: string[];
}

/** Hoisted alias; see the parse-hazard note in the project's recurring issues. */
type TraceOptionalFields = Partial<
  Omit<TraceRecord, "seq" | "turn" | "at" | "kind">
>;
type TraceInit = { turn: number; kind: TraceKind } & TraceOptionalFields;

/**
 * Red-flag findings the canonicaliser DERIVES from raw vitals. They are
 * supplied through the vitals form, never answered directly, so the client
 * must not offer them as questions. Mirrors canonicaliser.ts.
 */
const VITAL_DERIVED_FINDINGS: ReadonlySet<string> = new Set([
  "SYSTOLIC_BLOOD_PRESSURE_CATEGORY",
  "HEART_RATE_CATEGORY",
  "OXYGEN_SATURATION_CATEGORY",
]);

/** The minimum-safety-set observations. Single source: the safety gate. */
const MINIMUM_SET_IDS: ReadonlySet<string> = new Set(checkMinimumSafetySet({}).missing);

/**
 * Which recorded readings feed each DERIVED red-flag finding. Mirrors
 * canonicaliser.ts: blood pressure also depends on diastolic via MAP.
 * Findings not listed here are answered directly and are their own source.
 */
type SourceMap = Record<string, readonly string[]>;
const FINDING_SOURCES: SourceMap = {
  SYSTOLIC_BLOOD_PRESSURE_CATEGORY: ["VS_SBP", "VS_DBP"],
  HEART_RATE_CATEGORY: ["VS_HEART_RATE"],
  OXYGEN_SATURATION_CATEGORY: ["VS_SPO2_ROOM_AIR"],
};

function entriesOf(d: ReportedDistribution | null): DistributionEntry[] | null {
  if (!d) return null;
  return d.entries.map((e) => ({ id: e.id, probability: e.probability }));
}

export class SessionManager {
  constructor(
    private store: SessionStore,
    /** Everything InferenceSession needs EXCEPT careSetting, which is chosen
     *  per session at intake and supplied per request. */
    private baseEngineConfig: BaseEngineConfig,
    private redFlags: Record<string, RedFlagRule>,
    /** Question wording and answer options, from the pack. */
    private featuresRegistry: FeatureRegistryFile,
    /**
     * Maps a citation id to the id the client may see. Citations that support
     * only the UNKNOWN aggregate are withheld by the caller. Identity by default.
     */
    private publicCitationId: (citationId: string) => string = (id) => id
  ) {}

  async createSession(
    metadata: Omit<SessionMetadata, "sessionId" | "createdAt">
  ): Promise<SessionState> {
    const sessionId = randomUUID();
    const fullMetadata: SessionMetadata = {
      ...metadata,
      sessionId,
      createdAt: new Date().toISOString(),
    };
    const session = await this.store.create(fullMetadata);

    // Run the gate over no evidence so the client can show, from turn zero,
    // every red-flag check still waiting on a finding.
    const gate = evaluateGate({ evidence: {}, redFlags: this.redFlags });
    session.lastGateResult = gate;
    session.redFlagChecks = this.buildRedFlagChecks(gate);

    // nextQuestion / distribution stay null until the minimum safety set is met.
    await this.save(session);
    return session;
  }

  async submitEvidence(
    sessionId: string,
    req: SubmitEvidenceRequest
  ): Promise<SessionState> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.halted) throw new Error(`Session is halted`);

    const entryBase = {
      id: randomUUID(),
      featureId: req.featureId,
      value: req.value,
      source: req.source,
      observedAt: req.observedAt,
      observerConfidence: req.observerConfidence,
      turn: session.turn + 1,
    };

    const entry: EvidenceEntry =
      req.rawValue !== undefined ? { ...entryBase, rawValue: req.rawValue } : entryBase;

    const previous = entriesOf(session.distribution);

    // Validate BEFORE persisting. Previously a bad value was saved first and
    // then rejected, leaving it in the log to fail every later request.
    const canonInput = this.buildCanonInput([...session.evidenceLog, entry]);
    const canonicalEvidence = this.canonicaliseOrThrow(session, canonInput);

    await this.store.addEvidence(sessionId, entry);

    const gateResult = evaluateGate({
      evidence: canonicalEvidence,
      redFlags: this.redFlags,
    });
    session.lastGateResult = gateResult;
    session.minimumSafetySet = checkMinimumSafetySet(canonInput);

    if (gateResult.status === "HALT") {
      this.applyHalt(session, gateResult, canonicalEvidence);
      await this.store.recordHalt(
        sessionId,
        gateResult.status,
        gateResult.primaryRule ?? "UNKNOWN"
      );
      session.turn += 1;
      this.appendTrace(session, {
        turn: entry.turn,
        kind: "EVIDENCE_ADDED",
        featureId: entry.featureId,
        value: entry.value,
        evidenceId: entry.id,
        before: previous,
      });
      this.appendTrace(session, {
        turn: entry.turn,
        kind: "SESSION_HALTED",
        note: this.haltNote(session),
      });
      await this.save(session);
      return session;
    }

    session.redFlagChecks = this.buildRedFlagChecks(gateResult);

    if (!session.minimumSafetySet.complete) {
      session.turn += 1;
      this.appendTrace(session, {
        turn: entry.turn,
        kind: "EVIDENCE_ADDED",
        featureId: entry.featureId,
        value: entry.value,
        evidenceId: entry.id,
      });
      await this.save(session);
      return session;
    }

    const engineTrace = this.recomputeInference(session);
    session.turn += 1;

    const record = this.appendTrace(session, {
      turn: entry.turn,
      kind: "EVIDENCE_ADDED",
      featureId: entry.featureId,
      value: entry.value,
      evidenceId: entry.id,
      before: previous,
      after: entriesOf(session.distribution),
      citations: this.citationsFor(engineTrace, entry.featureId),
    });
    session.lastMovement = record;

    await this.save(session);
    return session;
  }

  async correctEvidence(
    sessionId: string,
    evidenceId: string,
    req: CorrectEvidenceRequest
  ): Promise<SessionState> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const oldEntry = session.evidenceLog.find((e) => e.id === evidenceId);
    if (!oldEntry) throw new Error(`Evidence ${evidenceId} not found`);

    const correctionBase = {
      id: randomUUID(),
      featureId: req.featureId,
      value: req.value,
      source: req.source,
      observedAt: req.observedAt,
      observerConfidence: req.observerConfidence,
      turn: session.turn + 1,
      corrects: evidenceId,
    };

    const correctionEntry: EvidenceEntry =
      req.rawValue !== undefined
        ? { ...correctionBase, rawValue: req.rawValue }
        : correctionBase;

    const previous = entriesOf(session.distribution);
    const wasHalted = session.halted;

    // Same validate-before-persist rule as submitEvidence.
    const canonInput = this.buildCanonInput([...session.evidenceLog, correctionEntry]);
    const canonicalEvidence = this.canonicaliseOrThrow(session, canonInput);

    await this.store.addEvidence(sessionId, correctionEntry);

    const gateResult = evaluateGate({
      evidence: canonicalEvidence,
      redFlags: this.redFlags,
    });
    session.lastGateResult = gateResult;
    session.minimumSafetySet = checkMinimumSafetySet(canonInput);
    session.turn += 1;

    let citations: TraceCitation[] = [];

    if (gateResult.status === "HALT") {
      this.applyHalt(session, gateResult, canonicalEvidence);
    } else {
      session.halted = false;
      session.haltReason = null;
      session.haltRule = null;
      session.halt = null;
      session.redFlagChecks = this.buildRedFlagChecks(gateResult);

      if (session.minimumSafetySet.complete) {
        const engineTrace = this.recomputeInference(session);
        citations = this.citationsFor(engineTrace, correctionEntry.featureId);
      } else {
        // Never leave a differential from before the safety set was lost.
        this.clearInference(session);
      }
    }

    const record = this.appendTrace(session, {
      turn: correctionEntry.turn,
      kind: "EVIDENCE_CORRECTED",
      featureId: correctionEntry.featureId,
      value: correctionEntry.value,
      previousValue: oldEntry.value,
      evidenceId: correctionEntry.id,
      corrects: oldEntry.id,
      before: previous,
      after: entriesOf(session.distribution),
      citations,
      note:
        oldEntry.featureId !== correctionEntry.featureId
          ? `Replaces ${oldEntry.featureId} = ${oldEntry.value}`
          : null,
    });

    if (session.halted) {
      this.appendTrace(session, {
        turn: correctionEntry.turn,
        kind: "SESSION_HALTED",
        note: this.haltNote(session),
      });
    } else if (wasHalted) {
      this.appendTrace(session, {
        turn: correctionEntry.turn,
        kind: "HALT_CLEARED",
        note: "Corrected evidence no longer fires any red-flag rule.",
      });
    }

    session.lastMovement = session.distribution ? record : null;

    await this.save(session);
    return session;
  }

  async deferQuestion(sessionId: string, featureId: string): Promise<SessionState> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.halted) throw new Error(`Session is halted`);

    const turn = session.turn + 1;
    const newlyDeferred = !session.deferredFeatureIds.some(
      (d) => d.featureId === featureId
    );
    if (newlyDeferred) {
      session.deferredFeatureIds.push({ featureId, deferredAtTurn: turn });
    }
    session.turn = turn;

    // No differential before the minimum safety set is met. The deferral is
    // still recorded and is picked up by replay once inference is available.
    if (session.minimumSafetySet.complete) {
      this.recomputeInference(session);
    }

    if (newlyDeferred) {
      const impact = session.pending.find((p) => p.featureId === featureId)
        ?.impactAtDeferral;
      this.appendTrace(session, {
        turn,
        kind: "QUESTION_DEFERRED",
        featureId,
        note:
          impact !== undefined ? `Impact at deferral ${impact.toFixed(4)} bits` : null,
      });
    }

    await this.save(session);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    return this.store.get(sessionId);
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  /** Every write goes through here so the answered list is never stale. */
  private async save(session: SessionState): Promise<void> {
    session.answeredEvidence = this.buildAnswered(session);
    await this.store.updateState(session.metadata.sessionId, session);
  }

  // ------------------------------------------------------------------
  // Evidence and canonicalisation
  // ------------------------------------------------------------------

  private reconstructEvidence(log: EvidenceEntry[]): Record<string, EvidenceEntry> {
    const corrected = new Set(log.filter((e) => e.corrects).map((e) => e.corrects!));
    const active = log.filter((e) => !corrected.has(e.id));

    const byFeature: Record<string, EvidenceEntry> = {};
    for (const entry of active) {
      byFeature[entry.featureId] = entry;
    }
    return byFeature;
  }

  /** Active evidence with wording, in the order it was recorded. */
  private buildAnswered(session: SessionState): AnsweredEvidence[] {
    const active = Object.values(this.reconstructEvidence(session.evidenceLog));
    active.sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));

    return active.map((e) => {
      const reg = this.featuresRegistry[e.featureId];
      return {
        evidenceId: e.id,
        featureId: e.featureId,
        value: e.value,
        rawValue: e.rawValue ?? null,
        turn: e.turn,
        isVital: MINIMUM_SET_IDS.has(e.featureId),
        prompt: reg ? reg.prompt : null,
        stateValues: reg ? [...reg.state_values] : null,
        tier: reg ? reg.tier : null,
      };
    });
  }

  /** Raw measurement when present, categorical value otherwise. */
  private buildCanonInput(log: EvidenceEntry[]): Record<string, string | number> {
    const current = this.reconstructEvidence(log);
    return Object.fromEntries(
      Object.entries(current).map(([k, v]) => [
        k,
        v.rawValue !== undefined ? v.rawValue : v.value,
      ])
    );
  }

  private canonicaliseOrThrow(
    session: SessionState,
    canonInput: Record<string, string | number>
  ): Record<string, string> {
    const result = canonicalise(canonInput, {
      isPregnant: session.metadata.patientPregnancy === "PREGNANT",
      isPostpartum6wk: session.metadata.patientPregnancy === "POSTPARTUM_6WK",
      ageYears: session.metadata.patientAge,
    });

    if (result.errors.length > 0) {
      throw new Error(
        `Canonicalisation failed: ${result.errors
          .map((e) => `${e.featureId}: ${e.error}`)
          .join("; ")}. Full canonInput was: ${JSON.stringify(canonInput)}`
      );
    }

    return Object.fromEntries(
      Object.entries(result.canonical).filter(([, v]) => v !== null)
    ) as Record<string, string>;
  }

  // ------------------------------------------------------------------
  // Halt and red-flag presentation
  // ------------------------------------------------------------------

  /**
   * A halted session carries no differential. Nulling the fields, rather than
   * relying on the client to check `halted`, means they cannot be rendered by
   * accident.
   */
  private applyHalt(
    session: SessionState,
    gate: GateResult,
    canonicalEvidence: Record<string, string>
  ): void {
    session.halted = true;
    session.haltReason = gate.status;
    session.haltRule = gate.primaryRule;
    session.halt = this.buildHaltInfo(session, gate, canonicalEvidence);
    session.redFlagChecks = [];
    this.clearInference(session);
  }

  private clearInference(session: SessionState): void {
    session.distribution = null;
    session.nextQuestion = null;
    session.pending = [];
    session.lastMovement = null;
  }

  private buildHaltInfo(
    session: SessionState,
    gate: GateResult,
    canonicalEvidence: Record<string, string>
  ): HaltInfo {
    // Only current (non-retracted) readings can be corrected.
    const active = this.reconstructEvidence(session.evidenceLog);
    const sourcesOf = (findingId: string) =>
      (FINDING_SOURCES[findingId] ?? [findingId]).flatMap((featureId) => {
        const entry = active[featureId];
        return entry ? [{ evidenceId: entry.id, featureId }] : [];
      });

    const rules = gate.firedRules.map((ruleId) => {
      const rule = this.redFlags[ruleId];
      return {
        ruleId,
        displayName: rule?.display_name ?? ruleId,
        clinicalRationale: rule?.clinical_rationale ?? "",
        haltMessage: rule?.halt_message ?? "",
        triggers: (rule?.triggers ?? []).map((t) => {
          const observed = canonicalEvidence[t.finding_id] ?? null;
          return {
            findingId: t.finding_id,
            requiredState: t.required_state,
            description: t.description,
            observedState: observed,
            matched: observed === t.required_state,
            sourceEvidence: sourcesOf(t.finding_id),
          };
        }),
      };
    });

    return {
      primaryRule: gate.primaryRule ?? rules[0]?.ruleId ?? "UNKNOWN",
      rules,
    };
  }

  private haltNote(session: SessionState): string | null {
    const primary = session.halt?.rules.find(
      (r) => r.ruleId === session.halt?.primaryRule
    );
    if (!primary) return null;
    return `${primary.ruleId} ${primary.displayName}: ${primary.haltMessage.trim()}`;
  }

  private buildRedFlagChecks(gate: GateResult): RedFlagCheck[] {
    return gate.unevaluableRules.map((u) => ({
      ruleId: u.ruleId,
      displayName: this.redFlags[u.ruleId]?.display_name ?? u.ruleId,
      missingFindings: u.missingFeatures.map((featureId) => ({
        featureId,
        ...this.wordingFor(featureId),
        tier: this.tierFor(featureId),
        answerable: !VITAL_DERIVED_FINDINGS.has(featureId),
      })),
    }));
  }

  // ------------------------------------------------------------------
  // Inference
  // ------------------------------------------------------------------

  /**
   * Merge active evidence and deferrals into one timeline ordered by turn.
   * Order matters: InferenceSession.answer() calls queue.resolve(), which only
   * drops a feature from the deferred queue if the .defer() replay came first.
   */
  private buildReplaySteps(session: SessionState): ReplayStep[] {
    const active = this.reconstructEvidence(session.evidenceLog);

    const answerSteps: ReplayStep[] = Object.values(active).map((e) => ({
      turn: e.turn,
      kind: "answer",
      featureId: e.featureId,
      value: e.value,
    }));

    const deferSteps: ReplayStep[] = session.deferredFeatureIds.map((d) => ({
      turn: d.deferredAtTurn,
      kind: "defer",
      featureId: d.featureId,
    }));

    return [...answerSteps, ...deferSteps].sort((a, b) => a.turn - b.turn);
  }

  /** Rebuild a fresh InferenceSession from durable state via full replay. */
  private buildInferenceSession(session: SessionState): InferenceSession {
    const config: EngineSessionConfig = {
      ...this.baseEngineConfig,
      // Care setting comes from the session's own intake, not a server global.
      careSetting: session.metadata.careSetting,
    };

    const inference = new InferenceSession(config);

    for (const step of this.buildReplaySteps(session)) {
      if (step.kind === "answer") {
        inference.answer(step.featureId, step.value);
      } else {
        inference.defer(step.featureId);
      }
    }

    return inference;
  }

  /**
   * Wording for a question comes from the pack, never from the client. A
   * feature with no registry entry fails loudly instead of rendering blank.
   */
  private wordingFor(featureId: string): FeatureWording {
    const entry = this.featuresRegistry[featureId];
    if (!entry) {
      throw new Error(`Feature "${featureId}" is not in the features registry.`);
    }
    return { prompt: entry.prompt, stateValues: [...entry.state_values] };
  }

  private tierFor(featureId: string): string {
    const entry = this.featuresRegistry[featureId];
    if (!entry) {
      throw new Error(`Feature "${featureId}" is not in the features registry.`);
    }
    return entry.tier;
  }

  /**
   * Replay, then copy the engine's read-model onto the persisted record.
   * Returns the engine's own (unfiltered) trace for citation lookup; it is
   * never stored or sent.
   */
  private recomputeInference(session: SessionState): readonly EngineTraceEntry[] {
    const inference = this.buildInferenceSession(session);
    const state: EngineSessionState = inference.state();
    const inScope = new Set<string>(this.baseEngineConfig.inScopeConditionIds);

    // Everything is computed before anything is assigned, so a registry
    // failure cannot leave the session half-updated.
    const nextQuestion: AskableQuestion | null = state.nextQuestion
      ? {
          ...state.nextQuestion,
          // Can name shadow conditions; only in-scope ids may leave the server.
          incoherentHypotheses: state.nextQuestion.incoherentHypotheses.filter((id) =>
            inScope.has(id)
          ),
          ...this.wordingFor(state.nextQuestion.featureId),
        }
      : null;

    const pending: PendingQuestion[] = state.pending.map((q) => ({
      ...q,
      ...this.wordingFor(q.featureId),
    }));

    // The server ranks; the client renders in the order received.
    const ranked: ReportedDistribution = {
      ...state.distribution,
      entries: [...state.distribution.entries].sort(
        (a, b) => b.probability - a.probability || a.id.localeCompare(b.id)
      ),
    };

    session.distribution = ranked;
    session.nextQuestion = nextQuestion;
    session.pending = pending;

    return inference.trace();
  }

  /**
   * Citations for the belief change a finding caused. Shadow hypotheses are
   * reported as "UNKNOWN", the same aggregate the distribution uses, so no
   * shadow id leaves the server.
   */
  private citationsFor(
    trace: readonly EngineTraceEntry[],
    featureId: string
  ): TraceCitation[] {
    const inScope = new Set<string>(this.baseEngineConfig.inScopeConditionIds);
    const out: TraceCitation[] = [];
    const seen = new Set<string>();

    for (const e of trace) {
      if (e.type !== "EVIDENCE" || e.featureId !== featureId) continue;
      if (!e.citationId || e.hypothesisId === null) continue;
      const hypothesisId = inScope.has(e.hypothesisId) ? e.hypothesisId : "UNKNOWN";
      const citationId = this.publicCitationId(e.citationId);
      const key = `${hypothesisId}|${citationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hypothesisId, citationId });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Trace
  // ------------------------------------------------------------------

  /** The only way a trace record is created. There is no edit or delete. */
  private appendTrace(session: SessionState, init: TraceInit): TraceRecord {
    const record: TraceRecord = {
      seq: session.trace.length,
      turn: init.turn,
      at: new Date().toISOString(),
      kind: init.kind,
      featureId: init.featureId ?? null,
      value: init.value ?? null,
      previousValue: init.previousValue ?? null,
      evidenceId: init.evidenceId ?? null,
      corrects: init.corrects ?? null,
      before: init.before ?? null,
      after: init.after ?? null,
      citations: init.citations ?? [],
      note: init.note ?? null,
    };
    session.trace.push(record);
    return record;
  }
}