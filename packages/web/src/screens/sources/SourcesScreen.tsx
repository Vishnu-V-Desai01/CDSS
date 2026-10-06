import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Search } from 'lucide-react'

export interface HeaderView {
  packLabel: string
  backHref: string | null
  backLabel: string
  connectionLabel: string
  connectionOk: boolean
}
export interface ChipView {
  value: string
  label: string
  selected: boolean
}
export type TabId = 'likelihoods' | 'priors' | 'citations'
export interface CitationDetailView {
  id: string
  title: string
  authors: string
  yearLabel: string
  typeLabel: string
  gradeLabel: string
  tableOrFigure: string
  doiLabel: string
  pmidLabel: string
  notes: string | null
  citedBy: string[]
}
export interface CitationLinkView {
  id: string
  label: string
  href: string
}
export interface LikelihoodRowView {
  key: string
  conditionName: string
  findingLabel: string
  stateLabel: string
  lrLabel: string
  gradeLabel: string | null
  derivedLabel: string
  tierLabel: string
  costLabel: string
  verificationLabel: string
  citation: CitationLinkView | null
  detail: CitationDetailView | null
}
export interface PriorRowView {
  key: string
  conditionName: string
  careSettingLabel: string
  weightLabel: string
  population: string
  gradeLabel: string | null
  verificationLabel: string
  citation: CitationLinkView | null
  detail: CitationDetailView | null
}
export interface CitationRowView {
  key: string
  detail: CitationDetailView
}
export interface TabView {
  id: TabId
  label: string
  count: number
}
export interface SourcesScreenProps {
  header: HeaderView
  unknownNote: string
  query: string
  conditionChips: ChipView[]
  gradeChips: ChipView[]
  tab: TabId
  tabs: TabView[]
  countLabel: string
  likelihoods: LikelihoodRowView[]
  priors: PriorRowView[]
  citations: CitationRowView[]
  nLabelFootnote: string
  focusId?: string
  onQueryChange: (q: string) => void
  onToggleCondition: (value: string) => void
  onToggleGrade: (value: string) => void
  onTabChange: (tab: TabId) => void
  onClearFilters: () => void
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2'
// One style for every grade. Grade A must look no more prominent than grade D.
const neutralBadge =
  'inline-flex min-w-16 items-center justify-center rounded border border-slate-300 bg-slate-50 px-2 py-1 text-center text-xs font-medium text-slate-800'

const likelihoodHeadings = [
  'Condition',
  'Finding',
  'State',
  'Likelihood ratio',
  'Grade',
  'Derived from (sens / spec / n as recorded)',
  'Tier',
  'Cost',
  'Verification',
  'Citation',
  'Details',
]
const priorHeadings = [
  'Condition',
  'Care setting',
  'Weight',
  'Population',
  'Grade',
  'Verification',
  'Citation',
  'Details',
]

function DetailPanel({ detail }: { detail: CitationDetailView }) {
  const fields: Array<[string, string]> = [
    ['Authors', detail.authors],
    ['Year', detail.yearLabel],
    ['Type', detail.typeLabel],
    ['Evidence grade', detail.gradeLabel],
    ['Table or figure', detail.tableOrFigure],
    ['DOI', detail.doiLabel],
    ['PMID', detail.pmidLabel],
  ]
  return (
    <div className="bg-white px-5 py-4 text-sm text-slate-800">
      <p className="font-semibold">{detail.title}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        {fields.map(([term, text]) => (
          <Fragment key={term}>
            <dt className="font-medium text-slate-600">{term}</dt>
            <dd>{text}</dd>
          </Fragment>
        ))}
      </dl>
      {detail.notes !== null && (
        <p className="mt-3 whitespace-pre-line text-slate-700">{detail.notes}</p>
      )}
      <p className="mt-3 border-t border-slate-200 pt-3">
        <span className="font-medium">Cited by:</span>{' '}
        {detail.citedBy.length > 0 ? detail.citedBy.join(', ') : '—'}
      </p>
    </div>
  )
}

function GradeBadge({ label }: { label: string | null }) {
  return label === null ? (
    <span className="text-slate-500">—</span>
  ) : (
    <span className={neutralBadge}>{label}</span>
  )
}

function CitationLink({ citation }: { citation: CitationLinkView | null }) {
  return citation === null ? (
    <span className="text-slate-500">—</span>
  ) : (
    <a
      className={`text-blue-700 underline decoration-transparent underline-offset-2 hover:decoration-current ${focusRing}`}
      href={citation.href}
    >
      {citation.label}
    </a>
  )
}

function ExpandButton({
  expanded,
  hasDetail,
  onToggle,
}: {
  expanded: boolean
  hasDetail: boolean
  onToggle: () => void
}) {
  if (!hasDetail) return <span className="text-slate-500">—</span>
  return (
    <button
      aria-expanded={expanded}
      className={`rounded text-slate-700 ${focusRing}`}
      onClick={onToggle}
      type="button"
    >
      {expanded ? (
        <ChevronDown aria-hidden="true" className="size-5" />
      ) : (
        <ChevronRight aria-hidden="true" className="size-5" />
      )}
      <span className="sr-only">Toggle citation details</span>
    </button>
  )
}

function EmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-slate-700">No rows match these filters.</p>
      <button
        className={`text-sm font-medium text-blue-700 underline underline-offset-4 ${focusRing}`}
        onClick={onClearFilters}
        type="button"
      >
        Clear filters
      </button>
    </div>
  )
}

function ChipGroup({
  label,
  chips,
  onToggle,
}: {
  label: string
  chips: ChipView[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mr-3 text-sm font-medium">{label}</legend>
      {chips.map((chip) => (
        <button
          aria-pressed={chip.selected}
          className={`rounded-full border px-3 py-1.5 text-sm ${chip.selected ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-slate-50 text-slate-800'} ${focusRing}`}
          key={chip.value}
          onClick={() => onToggle(chip.value)}
          type="button"
        >
          {chip.label}
        </button>
      ))}
    </fieldset>
  )
}

function LikelihoodRow({
  row,
  expanded,
  onToggle,
}: {
  row: LikelihoodRowView
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr>
        <th className="px-4 py-4 font-medium" scope="row">{row.conditionName}</th>
        <td className="max-w-xs px-4 py-4">{row.findingLabel}</td>
        <td className="px-4 py-4">{row.stateLabel}</td>
        <td className="px-4 py-4 font-semibold">{row.lrLabel}</td>
        <td className="px-4 py-4"><GradeBadge label={row.gradeLabel} /></td>
        <td className="px-4 py-4 font-mono text-xs">{row.derivedLabel}</td>
        <td className="px-4 py-4">{row.tierLabel}</td>
        <td className="px-4 py-4">{row.costLabel}</td>
        <td className="px-4 py-4">{row.verificationLabel}</td>
        <td className="px-4 py-4"><CitationLink citation={row.citation} /></td>
        <td className="px-4 py-4">
          <ExpandButton expanded={expanded} hasDetail={row.detail !== null} onToggle={onToggle} />
        </td>
      </tr>
      {expanded && row.detail !== null && (
        <tr>
          <td colSpan={11}>
            <div className="m-3 overflow-hidden rounded-md border border-slate-200">
              <DetailPanel detail={row.detail} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function PriorRow({
  row,
  expanded,
  onToggle,
}: {
  row: PriorRowView
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr>
        <th className="px-4 py-4 font-medium" scope="row">{row.conditionName}</th>
        <td className="px-4 py-4">{row.careSettingLabel}</td>
        <td className="px-4 py-4 font-semibold">{row.weightLabel}</td>
        <td className="max-w-sm px-4 py-4">{row.population}</td>
        <td className="px-4 py-4"><GradeBadge label={row.gradeLabel} /></td>
        <td className="px-4 py-4">{row.verificationLabel}</td>
        <td className="px-4 py-4"><CitationLink citation={row.citation} /></td>
        <td className="px-4 py-4">
          <ExpandButton expanded={expanded} hasDetail={row.detail !== null} onToggle={onToggle} />
        </td>
      </tr>
      {expanded && row.detail !== null && (
        <tr>
          <td colSpan={8}>
            <div className="m-3 overflow-hidden rounded-md border border-slate-200">
              <DetailPanel detail={row.detail} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function SourcesScreen(props: SourcesScreenProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // The only effect: bring a deep-linked citation into view.
  useEffect(() => {
    if (!props.focusId || props.tab !== 'citations') return
    const element = document.getElementById(props.focusId)
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.focus({ preventScroll: true })
  }, [props.focusId, props.tab])

  const toggle = (key: string) => setExpandedKey((current) => (current === key ? null : key))

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-blue-700 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <strong className="text-xl">CDS-CV</strong>
          <span className="rounded border border-blue-500 bg-blue-800 px-2 py-1 text-xs">
            {props.header.packLabel}
          </span>
          <div className="ml-auto flex items-center gap-5 text-sm">
            {props.header.backHref !== null && (
              <a
                className={`font-medium underline-offset-4 hover:underline ${focusRing}`}
                href={props.header.backHref}
              >
                {props.header.backLabel}
              </a>
            )}
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-500 px-3 py-1">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${props.header.connectionOk ? 'bg-emerald-400' : 'bg-slate-300'}`}
              />
              {props.header.connectionLabel}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">Sources</h1>
          <p className="mt-2 text-slate-700">
            Every likelihood ratio and prior used by the system, with its citation, population and evidence grade.
          </p>
          <div className="mt-4 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>{props.unknownNote}</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <label className="sr-only" htmlFor="sources-search">Search sources</label>
          <div className="flex items-center gap-3 rounded-md border border-slate-300 px-3 focus-within:ring-2 focus-within:ring-slate-700">
            <Search aria-hidden="true" className="size-4 text-slate-600" />
            <input
              className="min-h-11 w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
              id="sources-search"
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="Search findings, conditions, citations, authors"
              type="search"
              value={props.query}
            />
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <ChipGroup chips={props.conditionChips} label="Condition" onToggle={props.onToggleCondition} />
            <ChipGroup chips={props.gradeChips} label="Evidence grade" onToggle={props.onToggleGrade} />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-700" role="status">{props.countLabel}</span>
            <button
              className={`text-sm font-medium text-blue-700 underline underline-offset-4 ${focusRing}`}
              onClick={props.onClearFilters}
              type="button"
            >
              Clear filters
            </button>
          </div>
          <div aria-label="Source types" className="mt-5 flex gap-6 border-b border-slate-200" role="tablist">
            {props.tabs.map((item) => (
              <button
                aria-selected={props.tab === item.id}
                className={`border-b-2 px-1 pb-3 text-sm font-medium ${props.tab === item.id ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-700'} ${focusRing}`}
                key={item.id}
                onClick={() => props.onTabChange(item.id)}
                role="tab"
                type="button"
              >
                {item.label} <span className="ml-1">({item.count})</span>
              </button>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" role="tabpanel">
          {props.tab === 'citations' ? (
            props.citations.length === 0 ? (
              <EmptyState onClearFilters={props.onClearFilters} />
            ) : (
              <div className="flex flex-col divide-y divide-slate-200">
                {props.citations.map((row) => (
                  <article
                    className={`outline-none ${props.focusId === row.detail.id ? 'ring-2 ring-inset ring-slate-700' : ''}`}
                    id={row.detail.id}
                    key={row.key}
                    tabIndex={-1}
                  >
                    <DetailPanel detail={row.detail} />
                  </article>
                ))}
              </div>
            )
          ) : (props.tab === 'likelihoods' ? props.likelihoods.length : props.priors.length) === 0 ? (
            <EmptyState onClearFilters={props.onClearFilters} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-800">
                  <tr>
                    {(props.tab === 'likelihoods' ? likelihoodHeadings : priorHeadings).map((cell) => (
                      <th className="px-4 py-4 font-semibold" key={cell} scope="col">{cell}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {props.tab === 'likelihoods'
                    ? props.likelihoods.map((row) => (
                        <LikelihoodRow
                          expanded={expandedKey === row.key}
                          key={row.key}
                          onToggle={() => toggle(row.key)}
                          row={row}
                        />
                      ))
                    : props.priors.map((row) => (
                        <PriorRow
                          expanded={expandedKey === row.key}
                          key={row.key}
                          onToggle={() => toggle(row.key)}
                          row={row}
                        />
                      ))}
                </tbody>
              </table>
            </div>
          )}
          {props.tab === 'likelihoods' && (
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">{props.nLabelFootnote}</p>
          )}
        </section>
      </main>
    </div>
  )
}