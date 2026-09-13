'use client'

import { cn } from '@sim/emcn'

export interface FieldOption {
  value: string
  label: string
}

/**
 * HyperFix chat-light (Phase B2) : select natif habillé pour le dialogue
 * d'édition (pas de Radix Select en bibliothèque).
 */
export function FieldSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: FieldOption[]
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'w-full rounded border border-[var(--border)] bg-[var(--surface-3)] px-2 py-1.5 text-sm disabled:opacity-50',
        className
      )}
    >
      {placeholder && (
        <option value='' disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
