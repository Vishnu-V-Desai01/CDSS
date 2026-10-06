import { useState } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'

export interface Option {
  value: string
  label: string
}
export interface HeaderView {
  sessionId: string
  summary: string
  turnLabel: string
  statusLabel: string
  traceHref: string
  sourcesHref: string
}
export interface ConnectionView {
  ok: boolean
  label: string
}
export interface DifferentialRowView {
  id: string
  name: string
  percentLabel: string
  barPercent: number
  previousBarPercent: number | null
  movementLabel: string | null
  isUnknown: boolean
}
export interface DifferentialView {
  rows: DifferentialRowView[]
  contextLine: string
}
export interface CitationRefView {
  key: string
  label: string
  href: string
}
export interface LastUpdateView {
  title: string
  whenLabel: string
  citations: CitationRefView[]
  traceHref: string
}
export interface QuestionView {
  featureId: string
  prompt: string
  tierLabel: string
  costLabel: string
  impactLabel: string
  options: Option[]
}
export interface DeferredItemView {
  featureId: string
  prompt: string
  tierLabel: string
  costLabel: string
  impactLabel: string
  options: Option[]
}
export interface RedFlagFindingView {
  featureId: string
  prompt: string
  options: Option[]
  answerable: boolean
}
export interface RedFlagGroupView {
  ruleId: string
  ruleName: string
  findings: RedFlagFindingView[]
}
export type AnswerInputView =
  | { kind: 'options'; options: Option[] }
  | { kind: 'number'; unit: string }
export interface AnsweredItemView {
  evidenceId: string
  featureId: string
  prompt: string
  valueLabel: string
  input: AnswerInputView
  isVital: boolean
}
export type VitalInputView = { kind: 'number' } | { kind: 'select'; options: Option[] }
export interface VitalFieldView {
  featureId: string
  label: string
  unit: string
  input: VitalInputView
}
export interface ActiveBodyView {
  mode: 'active'
  differential: DifferentialView
  lastUpdate: LastUpdateView | null
  question: QuestionView | null
  noQuestionMessage: string
  deferred: DeferredItemView[]
  redFlagGroups: RedFlagGroupView[]
  answered: AnsweredItemView[]
}
export interface AwaitingBodyView {
  mode: 'awaiting-vitals'
  vitalFields: VitalFieldView[]
  submittedProgress: string | null
}
export type BodyView = AwaitingBodyView | ActiveBodyView

export interface ActiveSessionProps {
  header: HeaderView
  connection: ConnectionView
  body: BodyView
  isUpdating?: boolean
  actionError?: string
  vitalErrors?: Record<string, string>
  onAnswer: (featureId: string, value: string) => void
  onDefer: (featureId: string) => void
  onCorrect: (evidenceId: string, featureId: string, value: string) => void
  onSubmitVitals: (values: Record<string, string>) => void
}

const chip =
  'rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700'
const button =
  'rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:border-blue-500 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function Chips({
  tierLabel,
  costLabel,
  impactLabel,
}: Pick<QuestionView, 'tierLabel' | 'costLabel' | 'impactLabel'>) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className={chip}>{tierLabel}</span>
      <span className={chip}>{costLabel}</span>
      <span className={chip}>{impactLabel}</span>
    </div>
  )
}

function DifferentialCard({ view }: { view: DifferentialView }) {
  return (
    <section aria-live="polite" className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Differential</h2>
      <p className="mt-1 text-sm text-slate-600">
        Probability across named hypotheses. Not a diagnosis.
      </p>
      <div className="mt-6 flex flex-col gap-5">
        {view.rows.map((row) => (
          <div key={row.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{row.name}</span>
              <div className="flex items-baseline gap-2">
                {row.movementLabel ? (
                  <span className="text-xs text-slate-500">{row.movementLabel}</span>
                ) : null}
                <strong className="text-sm">{row.percentLabel}</strong>
              </div>
            </div>
            <div className="relative mt-2 h-4 rounded bg-slate-100">
              <div
                aria-label={`${row.name}: ${row.percentLabel}`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={row.barPercent}
                className={`h-full rounded ${row.isUnknown ? 'bg-slate-400' : 'bg-blue-500'} transition-[width] duration-200 ease-out`}
                role="progressbar"
                style={{ width: `${row.barPercent}%` }}
              />
              {row.previousBarPercent !== null ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-px bg-slate-800"
                  style={{ left: `${row.previousBarPercent}%` }}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500">
        {view.contextLine}
      </p>
    </section>
  )
}

function LastUpdateCard({ view }: { view: LastUpdateView | null }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Last update
      </h2>
      {view ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium">{view.title}</span>
            <span className="font-mono text-xs text-slate-500">{view.whenLabel}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {view.citations.map((citation) => (
                <a
                  className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                  href={citation.href}
                  key={citation.key}
                >
                  {citation.label}
                </a>
              ))}
            </div>
            <a className="text-sm font-medium text-blue-700 hover:underline" href={view.traceHref}>
              View in trace
            </a>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          No movement yet. The first answer after vitals will appear here.
        </p>
      )}
    </section>
  )
}

function RedFlags({
  groups,
  onAnswer,
}: {
  groups: RedFlagGroupView[]
  onAnswer: ActiveSessionProps['onAnswer']
}) {
  const hasFindings = groups.some((group) => group.findings.length > 0)
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-5 text-slate-600" />
        <h2 className="text-lg font-semibold">Red-flag checks awaiting findings</h2>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        These checks cannot fire until the finding is answered.
      </p>
      {hasFindings ? (
        <div className="mt-5 flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.ruleId}>
              <h3 className="text-sm font-semibold text-slate-800">{group.ruleName}</h3>
              <div className="mt-2 divide-y divide-slate-100">
                {group.findings.map((finding) => (
                  <div
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    key={finding.featureId}
                  >
                    <p className="text-sm text-slate-700">{finding.prompt}</p>
                    {finding.answerable ? (
                      <div className="flex flex-wrap gap-2">
                        {finding.options.map((option) => (
                          <button
                            className={button}
                            key={option.value}
                            onClick={() => onAnswer(finding.featureId, option.value)}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">Derived from vitals</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-500">
          No red-flag checks are waiting on findings.
        </p>
      )}
    </section>
  )
}

function NextQuestion({
  question,
  emptyMessage,
  onAnswer,
  onDefer,
}: {
  question: QuestionView | null
  emptyMessage: string
  onAnswer: ActiveSessionProps['onAnswer']
  onDefer: ActiveSessionProps['onDefer']
}) {
  return (
    <section className="rounded-lg border-l-4 border-slate-400 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Next question</h2>
      {question ? (
        <>
          <div className="mt-3">
            <Chips
              costLabel={question.costLabel}
              impactLabel={question.impactLabel}
              tierLabel={question.tierLabel}
            />
          </div>
          <p className="mt-5 text-lg leading-7 text-slate-900">{question.prompt}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {question.options.map((option) => (
              <button
                className={`${button} min-h-12 text-base`}
                key={option.value}
                onClick={() => onAnswer(question.featureId, option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="mt-5 w-full text-sm text-slate-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={() => onDefer(question.featureId)}
            type="button"
          >
            Defer this question
          </button>
        </>
      ) : (
        <p className="mt-4 rounded bg-slate-50 p-4 text-sm text-slate-600">{emptyMessage}</p>
      )}
    </section>
  )
}

function Deferred({
  items,
  onAnswer,
}: {
  items: DeferredItemView[]
  onAnswer: ActiveSessionProps['onAnswer']
}) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Deferred ({items.length})</h2>
      {items.length ? (
        <div className="mt-5 divide-y divide-slate-100">
          {items.map((item) => (
            <div className="py-4 first:pt-0 last:pb-0" key={item.featureId}>
              <p className="text-sm font-medium">{item.prompt}</p>
              <div className="mt-3">
                <Chips
                  costLabel={item.costLabel}
                  impactLabel={item.impactLabel}
                  tierLabel={item.tierLabel}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.options.map((option) => (
                  <button
                    className={button}
                    key={option.value}
                    onClick={() => onAnswer(item.featureId, option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Nothing deferred.</p>
      )}
    </section>
  )
}

function Answered({
  items,
  onCorrect,
}: {
  items: AnsweredItemView[]
  onCorrect: ActiveSessionProps['onCorrect']
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const nonVitals = items.filter((item) => !item.isVital)
  const vitals = items.filter((item) => item.isVital)

  const open = (item: AnsweredItemView) => {
    setOpenId(item.evidenceId)
    setDraft('')
  }
  const close = () => {
    setOpenId(null)
    setDraft('')
  }
  const save = (item: AnsweredItemView, value: string) => {
    onCorrect(item.evidenceId, item.featureId, value)
    close()
  }

  const renderRow = (item: AnsweredItemView) => (
    <div className="border-b border-slate-100 py-3 last:border-0" key={item.evidenceId}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-700">
          {item.prompt} <strong className="text-slate-900">— {item.valueLabel}</strong>
        </p>
        <button
          className="shrink-0 text-xs font-medium text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={() => open(item)}
          type="button"
        >
          Correct
        </button>
      </div>
      {openId === item.evidenceId ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-slate-50 p-3">
          {item.input.kind === 'options' ? (
            item.input.options.map((option) => (
              <button
                className={button}
                key={option.value}
                onClick={() => save(item, option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))
          ) : (
            <>
              <label className="sr-only" htmlFor={`edit-${item.evidenceId}`}>
                New value for {item.prompt}
              </label>
              <input
                className="w-28 rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                id={`edit-${item.evidenceId}`}
                inputMode="decimal"
                onChange={(event) => setDraft(event.target.value)}
                step="any"
                type="number"
                value={draft}
              />
              {item.input.unit ? (
                <span className="text-sm text-slate-600">{item.input.unit}</span>
              ) : null}
              <button
                className={button}
                disabled={draft.trim() === ''}
                onClick={() => save(item, draft)}
                type="button"
              >
                Save
              </button>
            </>
          )}
          <button
            className="text-sm text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={close}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )

  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Answered ({items.length})</h2>
      {nonVitals.map(renderRow)}
      {vitals.length > 0 ? (
        <div className="mt-2">
          <button
            aria-expanded={vitalsOpen}
            className="flex w-full items-center justify-between border-t border-slate-100 py-3 text-left text-sm font-medium"
            onClick={() => setVitalsOpen(!vitalsOpen)}
            type="button"
          >
            <span>Vitals ({vitals.length} recorded)</span>
            {vitalsOpen ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
          {vitalsOpen ? <div>{vitals.map(renderRow)}</div> : null}
        </div>
      ) : null}
    </section>
  )
}

function AwaitingVitals({
  body,
  isUpdating,
  errors,
  onSubmit,
}: {
  body: AwaitingBodyView
  isUpdating: boolean
  errors: Record<string, string>
  onSubmit: ActiveSessionProps['onSubmitVitals']
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const setValue = (featureId: string, value: string) =>
    setValues((prev) => ({ ...prev, [featureId]: value }))

  return (
    <section className="mx-auto max-w-2xl rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Record vital signs</h2>
      <p className="mt-2 text-sm text-slate-600">
        The differential appears once all vital signs below are recorded.
      </p>
      <div className="mt-6 flex flex-col gap-5">
        {body.vitalFields.map((field) => {
          const error = errors[field.featureId]
          const errorId = `${field.featureId}-error`
          return (
            <div key={field.featureId}>
              <label className="block text-sm font-medium" htmlFor={field.featureId}>
                {field.label}
              </label>
              <div className="mt-2 flex items-center gap-2">
                {field.input.kind === 'number' ? (
                  <input
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={Boolean(error)}
                    className={`w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-500' : 'border-slate-300'}`}
                    id={field.featureId}
                    inputMode="decimal"
                    onChange={(event) => setValue(field.featureId, event.target.value)}
                    step="any"
                    type="number"
                    value={values[field.featureId] ?? ''}
                  />
                ) : (
                  <select
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={Boolean(error)}
                    className={`w-full rounded border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-500' : 'border-slate-300'}`}
                    id={field.featureId}
                    onChange={(event) => setValue(field.featureId, event.target.value)}
                    value={values[field.featureId] ?? ''}
                  >
                    <option value="">Select</option>
                    {field.input.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {field.unit ? (
                  <span className="shrink-0 text-sm text-slate-600">{field.unit}</span>
                ) : null}
              </div>
              {error ? (
                <p className="mt-1 text-sm text-red-600" id={errorId}>
                  {error}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
      <button
        className="mt-6 w-full rounded bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isUpdating}
        onClick={() => onSubmit(values)}
        type="button"
      >
        Record vitals
      </button>
      {body.submittedProgress ? (
        <p className="mt-3 text-center text-sm text-slate-600" role="status">
          {body.submittedProgress}
        </p>
      ) : null}
    </section>
  )
}

export default function ActiveSession({
  header,
  connection,
  body,
  isUpdating = false,
  actionError,
  vitalErrors = {},
  onAnswer,
  onDefer,
  onCorrect,
  onSubmitVitals,
}: ActiveSessionProps) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-blue-700 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4">
          <strong className="text-lg">CDS-CV</strong>
          <p className="min-w-0 flex-1 text-center text-sm font-semibold sm:text-base">
            {header.summary}
          </p>
          <nav className="flex items-center gap-5 text-sm">
            <a
              className="hover:underline focus:outline-none focus:ring-2 focus:ring-white"
              href={header.traceHref}
            >
              Trace
            </a>
            <a
              className="hover:underline focus:outline-none focus:ring-2 focus:ring-white"
              href={header.sourcesHref}
            >
              Sources
            </a>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${connection.ok ? 'bg-emerald-400' : 'bg-slate-400'}`}
            />
            {connection.label}
          </div>
        </div>
      </header>

      {actionError ? (
        <div className="mx-auto max-w-[1440px] bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError}
        </div>
      ) : null}

      <main className="mx-auto max-w-[1440px] px-4 py-5">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="rounded border border-slate-300 bg-slate-50 px-3 py-1 text-sm">
            {header.statusLabel}
          </span>
          <span className="text-sm text-slate-500">Session ID: {header.sessionId}</span>
          {isUpdating ? (
            <span
              className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
              role="status"
            >
              Updating…
            </span>
          ) : null}
          <span className="ml-auto text-sm text-slate-500">{header.turnLabel}</span>
        </div>

        <div
          aria-busy={isUpdating}
          className={`transition-opacity ${isUpdating ? 'pointer-events-none opacity-60' : ''}`}
        >
          {body.mode === 'awaiting-vitals' ? (
            <AwaitingVitals
              body={body}
              errors={vitalErrors}
              isUpdating={isUpdating}
              onSubmit={onSubmitVitals}
            />
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
              <div className="flex flex-col gap-6">
                <DifferentialCard view={body.differential} />
                <LastUpdateCard view={body.lastUpdate} />
                <RedFlags groups={body.redFlagGroups} onAnswer={onAnswer} />
              </div>
              <div className="flex flex-col gap-6">
                <NextQuestion
                  emptyMessage={body.noQuestionMessage}
                  onAnswer={onAnswer}
                  onDefer={onDefer}
                  question={body.question}
                />
                <Deferred items={body.deferred} onAnswer={onAnswer} />
                <Answered items={body.answered} onCorrect={onCorrect} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}