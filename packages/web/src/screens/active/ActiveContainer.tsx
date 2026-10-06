import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SessionState } from '@cds/session-store';
import ActiveSession from './ActiveSession';
import {
  answerInput,
  correctionInput,
  missingVitalIds,
  toActiveView,
  validateVitalDrafts,
  vitalInput,
} from './view-model';
import {
  correctEvidence,
  deferQuestion,
  getSession,
  submitEvidence,
} from '../../api/endpoints';
import {
  ContractError,
  HttpError,
  NetworkError,
  extractServerMessage,
} from '../../api/errors';
import ErrorState from '../../components/ErrorState';
import PendingState from '../../components/PendingState';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; message: string; detail?: string }
  | { kind: 'ready'; session: SessionState; lastOkAt: Date };

/** The route param is read here and passed down; nothing below reads a global. */
export default function ActiveContainer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) {
    return (
      <ErrorState
        message="The address has no session id."
        onRetry={() => window.location.assign('/intake')}
        title="No session"
      />
    );
  }
  return <ActiveSessionLoader sessionId={sessionId} />;
}

/**
 * 4xx replies that mean "the server refused this and changed nothing". The
 * numbers on screen were just confirmed by the server, so they stay.
 * 404 (session gone) and 423 (halted) are handled separately.
 */
function isRejection(err: unknown): err is HttpError {
  return (
    err instanceof HttpError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 404 &&
    err.status !== 423
  );
}

function describeFatal(err: unknown): { title: string; message: string; detail?: string } {
  if (err instanceof NetworkError) {
    return {
      title: 'Backend not reachable',
      message: 'No numbers are shown because the current state is unknown. Start the API server, then retry.',
    };
  }
  if (err instanceof HttpError) {
    const text = extractServerMessage(err.body) ?? `HTTP ${err.status}`;
    return {
      title: err.status === 404 ? 'Session not found' : 'The server reported an error',
      message: text,
      detail: err.requestId ? `Request ID: ${err.requestId}` : undefined,
    };
  }
  if (err instanceof ContractError) {
    return {
      title: 'Unexpected response from the server',
      message: 'The response did not match the expected format, so nothing is shown.',
      detail: err.detail,
    };
  }
  return { title: 'Unexpected error', message: 'Something went wrong. Retry.' };
}

function rejectionMessage(err: HttpError): string {
  return extractServerMessage(err.body) ?? `The server rejected the request (HTTP ${err.status}).`;
}

function ActiveSessionLoader({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [isUpdating, setIsUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [vitalErrors, setVitalErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const busy = useRef(false);

  // The server is authoritative: every response replaces the held session
  // wholesale. A halted session leaves this screen immediately.
  const accept = useCallback(
    (session: SessionState) => {
      setLoad({ kind: 'ready', session, lastOkAt: new Date() });
      if (session.halted) navigate(`/session/${sessionId}/halt`, { replace: true });
    },
    [navigate, sessionId],
  );

  const fail = useCallback((err: unknown) => {
    setLoad({ kind: 'error', ...describeFatal(err) });
  }, []);

  const refetch = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoad({ kind: 'loading' });
      try {
        const session = await getSession(sessionId);
        if (!isCancelled()) accept(session);
      } catch (err) {
        if (!isCancelled()) fail(err);
      }
    },
    [sessionId, accept, fail],
  );

  useEffect(() => {
    let cancelled = false;
    void refetch(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  async function handleFailure(err: unknown, fieldId?: string): Promise<void> {
    if (err instanceof HttpError && err.status === 423) {
      try {
        accept(await getSession(sessionId));
      } catch (inner) {
        fail(inner);
      }
      return;
    }
    if (isRejection(err)) {
      const message = rejectionMessage(err);
      if (fieldId) setVitalErrors({ [fieldId]: message });
      else setActionError(message);
      return;
    }
    // Network failure, 5xx, 404 or a contract mismatch: the outcome is
    // unknown, so the numbers are replaced by an error, never left beside it.
    fail(err);
  }

  async function mutate(run: () => Promise<SessionState>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setIsUpdating(true);
    setActionError('');
    try {
      accept(await run());
    } catch (err) {
      await handleFailure(err);
    } finally {
      busy.current = false;
      setIsUpdating(false);
    }
  }

  if (load.kind === 'loading') return <PendingState label="Loading session…" />;
  if (load.kind === 'error') {
    return (
      <ErrorState
        detail={load.detail}
        message={load.message}
        onRetry={() => void refetch()}
        title={load.title}
      />
    );
  }

  const session = load.session;
  const view = toActiveView(session, load.lastOkAt);

  function handleAnswer(featureId: string, value: string): void {
    const tier =
      session.nextQuestion?.featureId === featureId
        ? session.nextQuestion.tier
        : (session.pending.find((p) => p.featureId === featureId)?.tier ??
          session.redFlagChecks
            .flatMap((c) => c.missingFindings)
            .find((f) => f.featureId === featureId)?.tier ??
          null);
    void mutate(() => submitEvidence(sessionId, answerInput(featureId, value, tier)));
  }

  function handleDefer(featureId: string): void {
    void mutate(() => deferQuestion(sessionId, featureId));
  }

  function handleCorrect(evidenceId: string, _featureId: string, draft: string): void {
    const item = session.answeredEvidence.find((a) => a.evidenceId === evidenceId);
    if (!item) {
      setActionError('That answer is no longer current. The screen has been refreshed.');
      void refetch();
      return;
    }
    const parsed = correctionInput(item, draft);
    if (!parsed.ok) {
      setActionError(parsed.error);
      return;
    }
    void mutate(() => correctEvidence(sessionId, evidenceId, parsed.input));
  }

  // Seven vitals are seven requests, in order. A halt mid-sequence (RF-01 can
  // fire on the second) stops the sequence and leaves for the HALT screen.
  async function handleSubmitVitals(values: Record<string, string>): Promise<void> {
    if (busy.current) return;
    const ids = missingVitalIds(session.minimumSafetySet.missing);
    const errors = validateVitalDrafts(ids, values);
    setVitalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    busy.current = true;
    setIsUpdating(true);
    setActionError('');
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        setProgress(`Recording ${i + 1} of ${ids.length}`);
        const parsed = vitalInput(id, values[id] ?? '');
        if (!parsed.ok) {
          setVitalErrors({ [id]: parsed.error });
          return;
        }
        try {
          const next = await submitEvidence(sessionId, parsed.input);
          accept(next);
          if (next.halted) return;
        } catch (err) {
          await handleFailure(err, id);
          return;
        }
      }
    } finally {
      busy.current = false;
      setIsUpdating(false);
      setProgress(null);
    }
  }

  const body =
    view.body.mode === 'awaiting-vitals'
      ? { ...view.body, submittedProgress: progress }
      : view.body;

  return (
    <ActiveSession
      actionError={actionError}
      body={body}
      connection={view.connection}
      header={view.header}
      isUpdating={isUpdating}
      onAnswer={handleAnswer}
      onCorrect={handleCorrect}
      onDefer={handleDefer}
      onSubmitVitals={(values) => void handleSubmitVitals(values)}
      vitalErrors={vitalErrors}
    />
  );
}