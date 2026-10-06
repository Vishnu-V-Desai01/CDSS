import { useState } from 'react'
import { Check, CircleAlert, Minus } from 'lucide-react'

export interface Option {
  value: string
  label: string
}

export interface HaltHeaderView {
  sessionId: string
  summary: string
  traceHref: string
  sourcesHref: string
}

export interface ConnectionView {
  ok: boolean
  label: string
}

export type ReadingInputView =
  | { kind: 'options'; options: Option[] }
  | { kind: 'number'; unit: string }

export interface HaltReadingView {
  evidenceId: string
  featureId: string
  label: string
  valueLabel: string
  input: ReadingInputView
}

export interface HaltTriggerView {
  findingId: string
  description: string
  requiredLabel: string
  observedLabel: string | null
  matched: boolean
  readings: HaltReadingView[]
}

export interface HaltRuleView {
  ruleId: string
  ruleName: string
  rationale: string
  guidance: string
  isPrimary: boolean
  triggers: HaltTriggerView[]
}

export interface HaltScreenProps {
  header: HaltHeaderView
  connection: ConnectionView
  rules: HaltRuleView[]
  isUpdating?: boolean
  actionError?: string
  onCorrect: (evidenceId: string, featureId: string, value: string) => void
}

const correctionNote =
  'Correct a reading only if it was recorded in error. The original reading is kept in the record and the correction is added to the audit trail.'

function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600">{children}</h3>
}

function CorrectionEditor({
  reading,
  isUpdating,
  onCorrect,
  onCancel,
}: {
  reading: HaltReadingView
  isUpdating: boolean
  onCorrect: HaltScreenProps['onCorrect']
  onCancel: () => void
}) {
  const [draft, setDraft] = useState('')

  return (
    <div className="mt-4 rounded-lg border border-slate-300 bg-slate-100 p-4">
      <p className="rounded-md border border-slate-300 bg-slate-200 px-4 py-3 text-sm leading-6 text-slate-800">
        {correctionNote}
      </p>
      {reading.input.kind === 'options' ? (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Correction options">
          {reading.input.options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={isUpdating}
              onClick={() => onCorrect(reading.evidenceId, reading.featureId, option.value)}
              className="rounded-md border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`correction-${reading.evidenceId}`} className="sr-only">
              Corrected reading
            </label>
            <input
              id={`correction-${reading.evidenceId}`}
              type="number"
              step="any"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={isUpdating}
              className="h-11 w-36 rounded-md border border-slate-300 bg-white px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200"
            />
          </div>
          <span className="pb-2 text-base text-slate-800">{reading.input.unit}</span>
          <button
            type="button"
            disabled={draft.length === 0 || isUpdating}
            onClick={() => onCorrect(reading.evidenceId, reading.featureId, draft)}
            className="rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save correction
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 rounded-md px-1 py-1 text-sm font-medium text-slate-700 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Cancel
      </button>
    </div>
  )
}

export default function HaltScreen({
  header,
  connection,
  rules,
  isUpdating = false,
  actionError,
  onCorrect,
}: HaltScreenProps) {
  const [openReading, setOpenReading] = useState<string | null>(null)
  const primaryRule = rules.find((rule) => rule.isPrimary) ?? rules[0]

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="flex min-h-16 flex-wrap items-center gap-4 bg-blue-700 px-6 py-3 text-white lg:flex-nowrap">
        <div className="shrink-0 rounded-md border border-blue-400 px-3 py-1 text-xl font-bold tracking-wide">CDS-CV</div>
        <div className="min-w-0 flex-1 text-center text-base font-semibold lg:text-lg">{header.summary}</div>
        <nav className="flex shrink-0 items-center gap-6 text-sm font-medium lg:text-base" aria-label="Session links">
          <a href={header.traceHref} className="rounded-sm underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-white">Trace</a>
          <a href={header.sourcesHref} className="rounded-sm underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-white">Sources</a>
        </nav>
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-blue-500 px-3 py-1 text-sm">
          <span className={`size-2.5 rounded-full ${connection.ok ? 'bg-emerald-400' : 'bg-slate-300'}`} aria-hidden="true" />
          <span>{connection.label}</span>
        </div>
      </header>

      <section className="bg-red-700 px-6 py-7 text-white" role="alert">
        <div className="mx-auto flex max-w-5xl items-start gap-5">
          <CircleAlert className="mt-1 size-8 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">RED FLAG TRIGGERED — ASSESSMENT STOPPED</h1>
            {primaryRule && (
              <p className="mt-2 text-lg font-semibold">
                {primaryRule.ruleId} · {primaryRule.ruleName}
              </p>
            )}
            <p className="mt-2 text-sm">No probabilities are shown while a red-flag rule is active.</p>
          </div>
        </div>
      </section>

      {isUpdating && (
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <span className="inline-block rounded-full border border-slate-400 bg-white px-3 py-1 text-sm font-semibold text-slate-800" role="status">
            Checking…
          </span>
        </div>
      )}

      {actionError && (
        <div className="mx-auto max-w-4xl px-4 pt-5">
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
            {actionError}
          </div>
        </div>
      )}

      <main className={`mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 transition-opacity ${isUpdating ? 'pointer-events-none opacity-60' : ''}`}>
        {rules.map((rule) => (
          <section key={rule.ruleId} className="flex flex-col gap-6">
            {rules.length > 1 && (
              <h2 className="text-xl font-bold text-slate-900">
                {rule.ruleId} · {rule.ruleName}
              </h2>
            )}
            <article className="rounded-xl border border-l-4 border-slate-200 border-l-red-700 bg-white p-6 shadow-sm">
              <SectionLabel>Escalation guidance</SectionLabel>
              <p className="mt-4 text-2xl font-bold leading-tight text-slate-950">{rule.guidance}</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <SectionLabel>Why this rule fired</SectionLabel>
              <p className="mt-4 text-lg leading-8 text-slate-900">{rule.rationale}</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <SectionLabel>Findings that triggered this rule</SectionLabel>
              <div className="mt-6 flex flex-col gap-7">
                {rule.triggers.map((trigger) => (
                  <div key={trigger.findingId} className="border-b border-slate-200 pb-6 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-bold text-slate-950">{trigger.description}</h4>
                        <p className="mt-1 text-sm text-slate-600">Rule requires: {trigger.requiredLabel}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-800">
                        {trigger.matched ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          <Minus className="size-4" aria-hidden="true" />
                        )}
                        {trigger.matched ? 'Met' : 'Not met'}
                      </span>
                    </div>
                    {trigger.readings.length > 0 && (
                      <div className="mt-4 flex flex-col gap-2 border-l-2 border-slate-200 pl-4">
                        {trigger.readings.map((reading) => {
                          const readingKey = `${trigger.findingId}-${reading.evidenceId}-${reading.featureId}`
                          const isOpen = openReading === readingKey
                          return (
                            <div key={readingKey}>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                                <span>
                                  {reading.label} — {reading.valueLabel}
                                </span>
                                <button
                                  type="button"
                                  aria-expanded={isOpen}
                                  onClick={() => setOpenReading(isOpen ? null : readingKey)}
                                  className="rounded-sm text-sm font-medium text-blue-700 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                >
                                  Correct
                                </button>
                              </div>
                              {isOpen && (
                                <CorrectionEditor
                                  reading={reading}
                                  isUpdating={isUpdating}
                                  onCorrect={onCorrect}
                                  onCancel={() => setOpenReading(null)}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <p className="mt-4 text-sm text-slate-600">
                      {trigger.observedLabel !== null
                        ? `Classified as ${trigger.observedLabel} by the system.`
                        : 'Not recorded.'}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        ))}
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <SectionLabel>Clearing this alert</SectionLabel>
          <p className="mt-4 text-lg leading-8 text-slate-900">
            There is no override. If a reading was recorded in error, correct it and every red-flag rule is checked again. Until then, no assessment can continue.
          </p>
        </article>
      </main>
    </div>
  )
}