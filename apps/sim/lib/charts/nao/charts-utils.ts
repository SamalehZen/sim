/**
 * HyperFix chat-light (Phase B2) : utilitaires de graphiques portés depuis
 * nao (`apps/frontend/src/lib/charts.utils.ts` : plages de dates, clés).
 */

export type RangeOptions = Record<string, { label: string }>

export const DATE_RANGE_OPTIONS = {
  '7d': { label: 'Last 7 days' },
  '30d': { label: 'Last 30 days' },
  '3m': { label: 'Last 3 months' },
  '6m': { label: 'Last 6 months' },
  '1y': { label: 'Last year' },
  all: { label: 'All data' },
} satisfies RangeOptions

export type DateRange = keyof typeof DATE_RANGE_OPTIONS

/** Filters data by date range preset (relative to the latest date in the data, expects ascending sort) */
export function filterByDateRange<T extends Record<string, unknown>>(
  data: T[],
  xAxisKey: string,
  range: DateRange
): T[] {
  if (range === 'all' || data.length === 0) {
    return data
  }

  const latestDate = data.at(-1)?.[xAxisKey]
  if (latestDate == null) {
    return data
  }

  const cutoffDate = new Date(latestDate as string)
  if (!isValidDate(cutoffDate)) {
    return data
  }

  switch (range) {
    case '7d':
      cutoffDate.setTime(cutoffDate.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      cutoffDate.setTime(cutoffDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '3m':
      cutoffDate.setMonth(cutoffDate.getMonth() - 3)
      break
    case '6m':
      cutoffDate.setMonth(cutoffDate.getMonth() - 6)
      break
    case '1y':
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 1)
      break
    default:
      return data
  }

  return data.filter((item) => {
    const dateValue = item[xAxisKey]
    const date = new Date(dateValue as string)
    if (!isValidDate(date)) {
      return false
    }

    return date >= cutoffDate
  })
}

/** Sorts data chronologically (ascending) by a date key so charts render left-to-right */
export function sortByDateKey<T extends Record<string, unknown>>(data: T[], xAxisKey: string): T[] {
  return [...data].sort((a, b) => {
    const dateA = new Date(a[xAxisKey] as string)
    const dateB = new Date(b[xAxisKey] as string)
    const validA = isValidDate(dateA)
    const validB = isValidDate(dateB)
    if (!validA || !validB) {
      if (!validA && !validB) {
        return 0
      }
      return validA ? -1 : 1
    }
    return dateA.getTime() - dateB.getTime()
  })
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function hashValue(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    h = (h << 5) - h + char
    h = h & h
  }
  return Math.abs(h)
}

export const toKey = (value: string) => {
  return hashValue(value)
}

/**
 * Resolves the tooltip header label for a pie slice from its Recharts payload.
 */
export function resolvePieTooltipLabel(payload?: readonly { name?: unknown }[]): string {
  const name = payload?.[0]?.name
  return name == null ? '' : String(name)
}
