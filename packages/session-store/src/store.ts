// packages/session-store/src/store.ts
/**
 * SessionStore abstraction: session persistence layer.
 * Implementations: MemoryStore (tests), FileStore (prod with JSONL append).
 *
 * Per spec C4: trace is append-only. Sessions are never mutated in place.
 * Every operation returns a fresh snapshot.
 */

import { checkMinimumSafetySet } from "@cds/safety-gate";
import { SessionState, EvidenceEntry } from "./types.js";

export interface SessionStore {
  create(metadata: SessionState["metadata"]): Promise<SessionState>;
  get(sessionId: string): Promise<SessionState | null>;
  addEvidence(sessionId: string, entry: EvidenceEntry): Promise<void>;
  recordHalt(sessionId: string, reason: string, ruleId: string): Promise<void>;
  updateState(sessionId: string, state: SessionState): Promise<void>;
  listSessions(): Promise<string[]>;
  delete(sessionId: string): Promise<void>;
}

/** Shared initial-state builder so MemoryStore and FileStore can't drift apart. */
function initialState(metadata: SessionState["metadata"]): SessionState {
  return {
    metadata,
    halted: false,
    haltReason: null,
    haltRule: null,
    halt: null,
    turn: 0,
    evidenceLog: [],
    answeredEvidence: [],
    // Single source for the required-vitals list: the safety gate package.
    minimumSafetySet: checkMinimumSafetySet({}),
    distribution: null,
    lastMovement: null,
    lastGateResult: null,
    redFlagChecks: [],
    nextQuestion: null,
    deferredFeatureIds: [],
    pending: [],
    trace: [],
  };
}

/**
 * In-memory store: all sessions live in RAM, lost on restart.
 * For testing and for when CDS_PERSIST=0.
 */
export class MemoryStore implements SessionStore {
  private sessions = new Map<string, SessionState>();

  async create(metadata: SessionState["metadata"]): Promise<SessionState> {
    const state = initialState(metadata);
    this.sessions.set(metadata.sessionId, state);
    return state;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async addEvidence(sessionId: string, entry: EvidenceEntry): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} not found`);
    state.evidenceLog.push(entry);
  }

  async recordHalt(sessionId: string, reason: string, ruleId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} not found`);
    state.halted = true;
    state.haltReason = reason;
    state.haltRule = ruleId;
  }

  async updateState(sessionId: string, state: SessionState): Promise<void> {
    this.sessions.set(sessionId, state);
  }

  async listSessions(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/**
 * File-backed store: sessions persisted as append-only JSONL files.
 *
 * Directory structure:
 *   CDS_SESSION_DIR/  (default: ./sessions)
 *     {sessionId}/
 *       state.json       (full state snapshot, written on every update)
 *       evidence.jsonl   (append-only log of evidence entries)
 */
export class FileStore implements SessionStore {
  private fs: typeof import("fs/promises") | null = null;
  private path: typeof import("path") | null = null;
  private baseDir: string;
  private sessions = new Map<string, SessionState>();

  constructor(baseDir: string = "./sessions") {
    this.baseDir = baseDir;
  }

  private async loadModules() {
    if (!this.fs) {
      this.fs = await import("fs/promises");
      this.path = await import("path");
    }
  }

  async create(metadata: SessionState["metadata"]): Promise<SessionState> {
    await this.loadModules();
    const fs = this.fs!;
    const path = this.path!;

    const state = initialState(metadata);

    const sessionDir = path.join(this.baseDir, metadata.sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8"
    );
    await fs.writeFile(path.join(sessionDir, "evidence.jsonl"), "", "utf-8");

    this.sessions.set(metadata.sessionId, state);
    return state;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    await this.loadModules();
    const fs = this.fs!;
    const path = this.path!;

    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const sessionDir = path.join(this.baseDir, sessionId);
    const stateFile = path.join(sessionDir, "state.json");

    try {
      const content = await fs.readFile(stateFile, "utf-8");
      const state = JSON.parse(content) as SessionState;
      this.sessions.set(sessionId, state);
      return state;
    } catch {
      return null;
    }
  }

  async addEvidence(sessionId: string, entry: EvidenceEntry): Promise<void> {
    await this.loadModules();
    const fs = this.fs!;
    const path = this.path!;

    const sessionDir = path.join(this.baseDir, sessionId);
    const logFile = path.join(sessionDir, "evidence.jsonl");

    await fs.appendFile(logFile, JSON.stringify(entry) + "\n", "utf-8");

    const state = this.sessions.get(sessionId);
    if (state) {
      state.evidenceLog.push(entry);
    }
  }

  async recordHalt(sessionId: string, reason: string, ruleId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} not found`);
    state.halted = true;
    state.haltReason = reason;
    state.haltRule = ruleId;
    await this.updateState(sessionId, state);
  }

  async updateState(sessionId: string, state: SessionState): Promise<void> {
    await this.loadModules();
    const fs = this.fs!;
    const path = this.path!;

    const sessionDir = path.join(this.baseDir, sessionId);
    const stateFile = path.join(sessionDir, "state.json");

    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf-8");
    this.sessions.set(sessionId, state);
  }

  async listSessions(): Promise<string[]> {
    await this.loadModules();
    const fs = this.fs!;

    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.loadModules();
    const fs = this.fs!;
    const path = this.path!;

    const sessionDir = path.join(this.baseDir, sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
    this.sessions.delete(sessionId);
  }
}

/**
 * Factory: returns the appropriate store based on environment.
 * CDS_PERSIST=0 -> MemoryStore (fast, ephemeral, for tests and demo fallback)
 * CDS_PERSIST=1 or absent -> FileStore (default, survives restart)
 */
export function createSessionStore(): SessionStore {
  const persist = process.env.CDS_PERSIST;
  if (persist === "0") {
    return new MemoryStore();
  }
  const baseDir = process.env.CDS_SESSION_DIR || "./sessions";
  return new FileStore(baseDir);
}