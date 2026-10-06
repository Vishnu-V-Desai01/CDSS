export interface ErrorStateProps {
  title: string
  message: string
  detail?: string
  onRetry: () => void
}

/**
 * Replaces the whole screen body. No clinical value is shown beside it: when
 * the outcome of a request is unknown, last-known numbers are not displayed.
 */
export default function ErrorState({ title, message, detail, onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-sm" role="alert">
        <h1 className="text-lg font-semibold text-red-700">{title}</h1>
        <p className="mt-2 text-sm text-slate-700">{message}</p>
        {detail ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-600">
            {detail}
          </pre>
        ) : null}
        <button
          className="mt-5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </div>
    </div>
  )
}