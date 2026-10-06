export default function PendingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600"
      role="status"
    >
      <p className="text-sm">{label}</p>
    </div>
  )
}