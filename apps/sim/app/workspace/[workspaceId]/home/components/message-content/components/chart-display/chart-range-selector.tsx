/**
 * HyperFix chat-light (Phase B2) : sélecteur de plage de dates pour les
 * graphiques temporels, porté depuis nao
 * (`apps/frontend/src/components/tool-calls/display-chart-range-selector.tsx`).
 * ADAPTATION : select natif (pas de Radix Select en bibliothèque).
 */
import type { RangeOptions } from '@/lib/charts/nao/charts-utils'

interface Props<T extends RangeOptions> {
  selectedRange: keyof T
  options: T
  onRangeSelected: (range: keyof T) => void
}

export function ChartRangeSelector<T extends RangeOptions>({
  options,
  selectedRange,
  onRangeSelected,
}: Props<T>) {
  return (
    <select
      value={selectedRange as string}
      onChange={(e) => onRangeSelected(e.target.value as keyof T)}
      className='border-none bg-transparent text-[var(--text-tertiary)] text-xs outline-none'
      aria-label='Date range'
    >
      {Object.entries(options).map(([key, value]) => (
        <option key={key} value={key}>
          {value.label}
        </option>
      ))}
    </select>
  )
}
