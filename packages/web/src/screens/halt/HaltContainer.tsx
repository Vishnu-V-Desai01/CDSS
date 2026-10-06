import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SessionState } from '@cds/session-store';
import HaltScreen from './HaltScreen';
import { toHaltView } from './view-model';
import { correctionInput } from '../active/view-model';
import { correctEvidence, getSession } from '../../api/endpoints';
import { describeFatal, isRejection, rejectionMessage, type FatalView } from '../../api/describe';
import ErrorState from '../../components/ErrorState';
import PendingState from '../../components/PendingState';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; fatal: FatalView }
  | { kind: 'ready'; session: SessionState; lastOkAt: Date };

// A failure to load is not an all-clear, so this screen says so.
const UNREACHABLE =
  'The red-flag status of this session could not be loaded. A failure to load is not an all-clear. Start the API server, then retry.';

/** The route param is read here and passed down; nothing below reads a global. */
export default function HaltContainer() {
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
  return <HaltLoader sessionId={sessionId} />;
}

function HaltLoader({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [isUpdating, setIsUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const busy = useRef(false);

  // The server is authoritative. A session that is not halted never renders
  // here: the halted screen is dropped first, then the route changes.
  const accept = useCallback(
    (session: SessionState) => {
      if (!session.halted) {
        setLoad({ kind: 'loading' });
        navigate(`/session/${sessionId}/active`, { replace: true });
        return;
      }
      setLoad({ kind: 'ready', session, lastOkAt: new Date() });
    },
    [navigate, sessionId],
  );

  const fail = useCallback((err: unknown) => {
    setLoad({ kind: 'error', fatal: describeFatal(err, UNREACHABLE) });
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

  if (load.kind === 'loading') return <PendingState label="Checking red-flag status…" />;
  if (load.kind === 'error') {
    return (
      <ErrorState
        detail={load.fatal.detail}
        message={load.fatal.message}
        onRetry={() => void refetch()}
        title={load.fatal.title}
      />
    );
  }

  const session = load.session;
  // Only these three fields go to the view model. No probability can follow.
  const { metadata, halt, answeredEvidence } = session;
  const view = toHaltView({ metadata, halt, answeredEvidence }, load.lastOkAt);

  async function handleCorrect(evidenceId: string, _featureId: string, draft: string): Promise<void> {
    if (busy.current) return;
    const item = session.answeredEvidence.find((a) => a.evidenceId === evidenceId);
    if (!item) {
      setActionError('That reading is no longer current. The screen has been refreshed.');
      void refetch();
      return;
    }
    const parsed = correctionInput(item, draft);
    if (!parsed.ok) {
      setActionError(parsed.error);
      return;
    }

    busy.current = true;
    setIsUpdating(true);
    setActionError('');
    try {
      accept(await correctEvidence(sessionId, evidenceId, parsed.input));
    } catch (err) {
      if (isRejection(err)) setActionError(rejectionMessage(err));
      else fail(err); // unknown outcome: never leave the old screen standing
    } finally {
      busy.current = false;
      setIsUpdating(false);
    }
  }

  return (
    <HaltScreen
      actionError={actionError}
      connection={view.connection}
      header={view.header}
      isUpdating={isUpdating}
      onCorrect={(evidenceId, featureId, value) => void handleCorrect(evidenceId, featureId, value)}
      rules={view.rules}
    />
  );
}