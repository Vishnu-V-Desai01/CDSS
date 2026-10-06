import type { ChangeEvent } from 'react'
import { ChevronRight, LoaderCircle } from 'lucide-react'

export interface CareSettingOption {
  value: string
  label: string
}

export interface PatientIntakeFormValues {
  careSetting: string
  patientAge: string
  patientSex: string
  patientPregnancy: string
}

export interface FieldErrors {
  careSetting?: string
  patientAge?: string
  patientSex?: string
  patientPregnancy?: string
}

export interface PatientIntakeFormProps {
  values: PatientIntakeFormValues
  onFieldChange: (
    field: keyof PatientIntakeFormValues,
    value: string,
  ) => void
  onSubmit: () => void
  fieldErrors?: FieldErrors
  formError?: string
  isSubmitting?: boolean
  careSettingOptions?: CareSettingOption[]
  sexOptions?: CareSettingOption[]
  pregnancyOptions?: CareSettingOption[]
}

type FieldName = keyof PatientIntakeFormValues

// Named alias instead of an inline `keyof Pick<PatientIntakeFormProps, 'a' | 'b' | 'c'>`.
// keyof Pick<T, K> reduces to K when K already extends keyof T, so this is the
// same type, just without a second nested generic for the parser to untangle.
type OptionsFieldName = 'careSettingOptions' | 'sexOptions' | 'pregnancyOptions'

// Named alias instead of an inline multi-line `Array<{ ... }>` — the exact
// pattern documented as a recurring parse hazard in this project. Two nested
// multi-line generics (Array<{...}> wrapping keyof Pick<...>) was one nesting
// level too many for esbuild's TS parser.
interface IntakeFieldConfig {
  name: FieldName
  label: string
  id: string
  type: 'select' | 'number'
  options?: OptionsFieldName
}

const fields: IntakeFieldConfig[] = [
  {
    name: 'careSetting',
    label: 'Care Setting',
    id: 'patient-care-setting',
    type: 'select',
    options: 'careSettingOptions',
  },
  {
    name: 'patientAge',
    label: 'Age (years)',
    id: 'patient-age',
    type: 'number',
  },
  {
    name: 'patientSex',
    label: 'Sex',
    id: 'patient-sex',
    type: 'select',
    options: 'sexOptions',
  },
  {
    name: 'patientPregnancy',
    label: 'Pregnancy Status',
    id: 'patient-pregnancy',
    type: 'select',
    options: 'pregnancyOptions',
  },
]

export default function PatientIntakeForm({
  values,
  onFieldChange,
  onSubmit,
  fieldErrors = {},
  formError = '',
  isSubmitting = false,
  careSettingOptions = [],
  sexOptions = [],
  pregnancyOptions = [],
}: PatientIntakeFormProps) {
  const optionsByName = {
    careSettingOptions,
    sexOptions,
    pregnancyOptions,
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-900">
      <form
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-[0_10px_28px_rgba(15,23,42,0.14)]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="h-1.5 bg-blue-600" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <header className="mb-5">
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
              New Patient Session
            </h1>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Start a new consultation session.
            </p>
          </header>

          <div className="flex flex-col gap-4">
            {fields.map((field) => {
              const error = fieldErrors[field.name]
              const errorId = `${field.id}-error`
              const options = field.options ? optionsByName[field.options] : []
              const commonProps = {
                id: field.id,
                name: field.name,
                value: values[field.name],
                onChange: (
                  event: ChangeEvent<HTMLSelectElement | HTMLInputElement>,
                ) => onFieldChange(field.name, event.target.value),
                'aria-required': 'true' as const,
                'aria-invalid': Boolean(error),
                'aria-describedby': error ? errorId : undefined,
                className: `h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${error ? 'border-red-500' : 'border-slate-300'}`,
              }

              return (
                <div key={field.name}>
                  <label
                    className="mb-1.5 block text-xs font-medium uppercase tracking-[0.02em] text-slate-500"
                    htmlFor={field.id}
                  >
                    {field.label}
                  </label>
                  {field.type === 'number' ? (
                    <input {...commonProps} type="number" inputMode="numeric" />
                  ) : (
                    <select {...commonProps}>
                      <option value="" disabled>
                        Select…
                      </option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {error ? (
                    <p id={errorId} className="mt-1 text-xs text-red-600">
                      {error}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>

          {formError ? (
            <div
              className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              role="alert"
            >
              {formError}
            </div>
          ) : null}

          <button
            className="mt-5 flex h-9 w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            <span>{isSubmitting ? 'Starting…' : 'Start Session'}</span>
            {!isSubmitting ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : null}
          </button>
        </div>
      </form>
    </main>
  )
}