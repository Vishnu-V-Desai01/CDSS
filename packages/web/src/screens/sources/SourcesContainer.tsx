import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SourcesScreen, { type TabId } from './SourcesScreen';
import { NO_FILTERS, toSourcesView, toggled, type SourcesFilters } from './view-model';
import { getSources } from '../../api/endpoints';
import { describeFatal, type FatalView } from '../../api/describe';
import type { SourcesData } from '../../api/validateSources';
import ErrorState from '../../components/ErrorState';
import PendingState from '../../components/PendingState';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; fatal: FatalView }
  | { kind: 'ready'; data: SourcesData; lastOkAt: Date };

const UNREACHABLE = 'The knowledge pack could not be loaded. Start the API server, then retry.';

/** The optional ?session=<id> only drives the Back link; Sources is pack-level. */
function readFocus(): string | undefined {
  const hash = window.location.hash;
  if (hash.length <= 1) return undefined;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return undefined;
  }
}

export default function SourcesContainer() {
  const [params] = useSearchParams();
  return <SourcesLoader sessionId={params.get('session')} />;
}

function SourcesLoader({ sessionId }: { sessionId: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [filters, setFilters] = useState<SourcesFilters>(NO_FILTERS);
  const [focusId, setFocusId] = useState<string | undefined>(() => readFocus());
  const [tab, setTab] = useState<TabId>(() => (readFocus() ? 'citations' : 'likelihoods'));

  const refetch = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoad({ kind: 'loading' });
    try {
      const data = await getSources();
      if (!isCancelled()) setLoad({ kind: 'ready', data, lastOkAt: new Date() });
    } catch (err) {
      if (!isCancelled()) setLoad({ kind: 'error', fatal: describeFatal(err, UNREACHABLE) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refetch(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  // A citation link inside this page changes only the hash. Show that
  // citation: open its tab and clear any filter that could hide it.
  useEffect(() => {
    const onHash = () => {
      const id = readFocus();
      if (!id) return;
      setTab('citations');
      setFilters(NO_FILTERS);
      setFocusId(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (load.kind === 'loading') return <PendingState label="Loading sources…" />;
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

  const view = toSourcesView(load.data, filters, tab, {
    sessionId,
    lastOkAt: load.lastOkAt,
    focusId,
  });

  return (
    <SourcesScreen
      {...view}
      onClearFilters={() => setFilters(NO_FILTERS)}
      onQueryChange={(query) => setFilters((f) => ({ ...f, query }))}
      onTabChange={(next) => {
        setTab(next);
        setFocusId(undefined);
      }}
      onToggleCondition={(value) => setFilters((f) => ({ ...f, conditions: toggled(f.conditions, value) }))}
      onToggleGrade={(value) => setFilters((f) => ({ ...f, grades: toggled(f.grades, value) }))}
    />
  );
}