import { createBrowserRouter, Navigate } from 'react-router-dom';
import IntakeContainer from './screens/intake/IntakeContainer';
import ActiveContainer from './screens/active/ActiveContainer';
import HaltContainer from './screens/halt/HaltContainer';
import SourcesContainer from './screens/sources/SourcesContainer';

function Placeholder({ label }: { label: string }) {
  return <div className="p-8 text-slate-500">{label} — not built yet.</div>;
}

/**
 * /session/:sessionId/... from day one, so a list screen later only adds a
 * route and changes nothing here. Placeholders mark screens still to build.
 */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/intake" replace /> },
  { path: '/intake', element: <IntakeContainer /> },
  { path: '/session/:sessionId/active', element: <ActiveContainer /> },
  { path: '/session/:sessionId/halt', element: <HaltContainer /> },
  { path: '/session/:sessionId/trace', element: <Placeholder label="Trace" /> },
  { path: '/sources', element: <SourcesContainer /> },
]);