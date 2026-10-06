import type { SessionState } from '@cds/session-store';
import { CANDIDATE_IDS } from '@cds/shared-types';

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function req(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** The only hypothesis ids the client may ever receive. */
const ALLOWED_HYPOTHESES: ReadonlySet<string> = new Set<string>([...CANDIDATE_IDS, 'UNKNOWN']);

function checkDistribution(d: unknown): void {
  req(isRecord(d), 'distribution is not an object');
  req(isNum(d.scopeFit), 'distribution.scopeFit missing');
  req(Array.isArray(d.entries), 'distribution.entries missing');
  req(d.entries.length === ALLOWED_HYPOTHESES.size, 'distribution must have exactly five entries');
  const seen = new Set<string>();
  for (const e of d.entries) {
    req(isRecord(e) && isStr(e.id) && isNum(e.probability), 'malformed distribution entry');
    req(ALLOWED_HYPOTHESES.has(e.id), `unexpected hypothesis id in distribution: ${e.id}`);
    seen.add(e.id);
  }
  req(seen.size === ALLOWED_HYPOTHESES.size, 'distribution has duplicate entries');
}

function checkWording(q: Rec, where: string): void {
  req(isStr(q.featureId), `${where}.featureId missing`);
  req(isStr(q.prompt), `${where}.prompt missing`);
  req(isStrArray(q.stateValues), `${where}.stateValues missing`);
  req(isStr(q.tier), `${where}.tier missing`);
  req(isNum(q.cost), `${where}.cost missing`);
}

/**
 * The halt details the HALT screen renders. Every reading offered for
 * correction must be a current answered entry; otherwise the screen would
 * silently drop the one thing the clinician can act on.
 */
function checkHalt(h: unknown, answeredIds: ReadonlySet<string>): void {
  req(isRecord(h), 'halt details are missing');
  req(isStr(h.primaryRule), 'halt.primaryRule missing');
  req(Array.isArray(h.rules) && h.rules.length > 0, 'halt has no rules');
  for (const rule of h.rules) {
    req(isRecord(rule), 'malformed halt rule');
    req(isStr(rule.ruleId) && isStr(rule.displayName), 'malformed halt rule');
    req(isStr(rule.clinicalRationale) && isStr(rule.haltMessage), 'malformed halt rule');
    req(Array.isArray(rule.triggers), 'halt rule has no triggers');
    for (const t of rule.triggers) {
      req(isRecord(t), 'malformed halt trigger');
      req(isStr(t.findingId) && isStr(t.requiredState) && isStr(t.description), 'malformed halt trigger');
      req(t.observedState === null || isStr(t.observedState), 'halt trigger observedState malformed');
      req(typeof t.matched === 'boolean', 'halt trigger matched missing');
      req(Array.isArray(t.sourceEvidence), 'halt trigger sourceEvidence missing');
      for (const s of t.sourceEvidence) {
        req(isRecord(s) && isStr(s.evidenceId) && isStr(s.featureId), 'malformed halt source reading');
        req(answeredIds.has(s.evidenceId), `halt source ${s.evidenceId} is not a current answer`);
      }
    }
  }
}

/**
 * Structural check of everything the screens built so far read. Extend it
 * when a later screen consumes more of SessionState. An unvalidated field
 * shows up as a blank or wrong screen instead of an honest error.
 */
export function assertSessionState(value: unknown): SessionState {
  req(isRecord(value), 'response is not an object');

  // Tripwire: no hidden-condition name may reach any screen.
  req(!/shadow/i.test(JSON.stringify(value)), 'response names a hidden condition');

  const metadata = value.metadata;
  req(isRecord(metadata) && isStr(metadata.sessionId), 'missing metadata.sessionId');
  req(isStr(metadata.careSetting), 'missing metadata.careSetting');
  req(isNum(metadata.patientAge), 'missing metadata.patientAge');
  req(isStr(metadata.patientSex), 'missing metadata.patientSex');

  req(typeof value.halted === 'boolean', 'missing halted');
  req(isNum(value.turn), 'missing turn');
  req(Array.isArray(value.evidenceLog), 'missing evidenceLog');
  req(Array.isArray(value.trace), 'missing trace');
  req(Array.isArray(value.deferredFeatureIds), 'missing deferredFeatureIds');

  const mss = value.minimumSafetySet;
  req(isRecord(mss) && typeof mss.complete === 'boolean' && isStrArray(mss.missing), 'missing minimumSafetySet');

  req(Array.isArray(value.answeredEvidence), 'missing answeredEvidence');
  const answeredIds = new Set<string>();
  for (const a of value.answeredEvidence) {
    req(isRecord(a), 'malformed answeredEvidence entry');
    req(isStr(a.evidenceId) && isStr(a.featureId) && isStr(a.value), 'malformed answeredEvidence entry');
    req(isNum(a.turn) && typeof a.isVital === 'boolean', 'malformed answeredEvidence entry');
    req(a.prompt === null || isStr(a.prompt), 'answeredEvidence.prompt malformed');
    req(a.stateValues === null || isStrArray(a.stateValues), 'answeredEvidence.stateValues malformed');
    req(a.tier === null || isStr(a.tier), 'answeredEvidence.tier malformed');
    answeredIds.add(a.evidenceId);
  }

  req(Array.isArray(value.redFlagChecks), 'missing redFlagChecks');
  for (const c of value.redFlagChecks) {
    req(isRecord(c) && isStr(c.ruleId) && isStr(c.displayName), 'malformed redFlagCheck');
    req(Array.isArray(c.missingFindings), 'redFlagCheck.missingFindings missing');
    for (const f of c.missingFindings) {
      req(isRecord(f), 'malformed red-flag finding');
      req(isStr(f.featureId) && isStr(f.prompt) && isStrArray(f.stateValues), 'malformed red-flag finding');
      req(isStr(f.tier) && typeof f.answerable === 'boolean', 'malformed red-flag finding');
    }
  }

  req(Array.isArray(value.pending), 'missing pending');
  for (const p of value.pending) {
    req(isRecord(p), 'malformed pending entry');
    checkWording(p, 'pending');
    req(isNum(p.impactAtDeferral), 'pending.impactAtDeferral missing');
    req(p.currentImpact === null || isNum(p.currentImpact), 'pending.currentImpact malformed');
  }

  if (value.nextQuestion !== null) {
    req(isRecord(value.nextQuestion), 'nextQuestion malformed');
    checkWording(value.nextQuestion, 'nextQuestion');
    req(isNum(value.nextQuestion.eigBits), 'nextQuestion.eigBits missing');
  }

  if (value.distribution !== null) checkDistribution(value.distribution);

  if (value.lastMovement !== null) {
    const m = value.lastMovement;
    req(isRecord(m) && isStr(m.kind) && isNum(m.turn) && isStr(m.at), 'lastMovement malformed');
    req(Array.isArray(m.citations), 'lastMovement.citations missing');
    for (const c of m.citations) {
      req(isRecord(c) && isStr(c.hypothesisId) && isStr(c.citationId), 'malformed citation');
    }
    for (const side of [m.before, m.after]) {
      if (side !== null) {
        req(Array.isArray(side), 'lastMovement distribution malformed');
        for (const e of side) {
          req(isRecord(e) && isStr(e.id) && isNum(e.probability), 'lastMovement entry malformed');
          req(ALLOWED_HYPOTHESES.has(e.id), `unexpected hypothesis id in lastMovement: ${e.id}`);
        }
      }
    }
  }

  // A halted session must carry no probabilities, whatever the server sent.
  if (value.halted) {
    req(value.distribution === null, 'halted session carries a distribution');
    req(value.nextQuestion === null, 'halted session carries a next question');
    req(value.pending.length === 0, 'halted session carries a deferred queue');
    req(value.lastMovement === null, 'halted session carries a movement');
    checkHalt(value.halt, answeredIds);
  } else {
    req(value.halt === null, 'session carries halt details but is not halted');
    if (mss.complete) {
      req(value.distribution !== null, 'safety set complete but no distribution');
    }
  }

  return value as unknown as SessionState;
}

/** What GET /health tells the client about the loaded knowledge pack. */
export interface HealthInfo {
  status: string;
  knowledgePackVersion: string;
  knowledgePackHash: string;
  supportedCareSettings: string[];
}

export function assertHealthInfo(value: unknown): HealthInfo {
  req(isRecord(value), 'response is not an object');
  req(isStr(value.status), 'missing status');
  req(isStr(value.knowledgePackVersion), 'missing knowledgePackVersion');
  req(isStr(value.knowledgePackHash), 'missing knowledgePackHash');
  req(isStrArray(value.supportedCareSettings), 'missing supportedCareSettings');
  return value as unknown as HealthInfo;
}