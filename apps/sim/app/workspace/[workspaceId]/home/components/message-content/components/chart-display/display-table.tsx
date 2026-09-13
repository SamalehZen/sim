/**
 * HyperFix chat-light (Phase B2) : tableau de données avec tri + pagination,
 * porté depuis nao (`apps/frontend/src/components/tool-calls/display-table.tsx`).
 * ADAPTATIONS : format de dates = défaut, `cn`/icônes `@sim/emcn`.
 */

import { memo, useEffect, useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
import { ChevronDown, ChevronUp } from '@sim/emcn/icons'
import type {
  ColumnConditionalFormats,
  ColumnRange,
  ConditionalFormatRule,
} from '@/lib/charts/nao/conditional-formatting'
import {
  computeColumnRange,
  isConditionalFormatRule,
  resolveCellBackground,
} from '@/lib/charts/nao/conditional-formatting'
import { DEFAULT_DATE_FORMAT_SETTINGS } from '@/lib/charts/nao/date'
import type { SortDirection } from '@/lib/charts/nao/story-table-utils'
import {
  formatCellValue,
  formatColumnLabel,
  isNumericColumn,
  sortTableRows,
} from '@/lib/charts/nao/story-table-utils'
import { TablePagination } from './table-pagination'
import { TablePaginationCompact } from './table-pagination-compact'

type TableRow = Record<string, unknown>

interface TableDisplayProps {
  data: TableRow[]
  columns?: string[]
  title?: string
  className?: string
  tableContainerClassName?: string
  emptyLabel?: string
  showRowCount?: boolean
  maxRowsBeforePagination?: number
  compactFooter?: boolean
  conditionalFormats?: ColumnConditionalFormats
  humanizeColumnLabels?: boolean
}

type Sort = { column: string; direction: SortDirection }

export const TableDisplay = memo(function TableDisplay({
  data,
  columns,
  title,
  className,
  tableContainerClassName,
  emptyLabel = 'No rows returned',
  showRowCount = true,
  maxRowsBeforePagination = 100,
  compactFooter = false,
  conditionalFormats,
  humanizeColumnLabels = false,
}: TableDisplayProps) {
  const dateFormat = DEFAULT_DATE_FORMAT_SETTINGS
  const resolvedColumns = useMemo(
    () => (columns && columns.length > 0 ? columns : inferColumns(data)),
    [columns, data]
  )
  const numericColumns = useMemo(
    () => new Set(resolvedColumns.filter((column) => isNumericColumn(data, column))),
    [data, resolvedColumns]
  )
  const hasRows = data.length > 0
  const showPagination = hasRows && data.length > maxRowsBeforePagination

  const columnRanges = useMemo(
    () => computeFormattedColumnRanges(data, conditionalFormats),
    [data, conditionalFormats]
  )

  const columnMinWidths = useMemo(
    () => computeColumnMinWidths(data, resolvedColumns, dateFormat),
    [data, resolvedColumns, dateFormat]
  )

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(maxRowsBeforePagination)
  const [sort, setSort] = useState<Sort | null>(null)

  useEffect(() => setPageIndex(0), [data])

  const activeSort = sort && resolvedColumns.includes(sort.column) ? sort : null
  const sortedData = useMemo(
    () => (activeSort ? sortTableRows(data, activeSort.column, activeSort.direction) : data),
    [data, activeSort]
  )

  const pageCount = Math.ceil(sortedData.length / pageSize)
  const pageData = useMemo(
    () =>
      showPagination
        ? sortedData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
        : sortedData,
    [sortedData, pageIndex, pageSize, showPagination]
  )

  function toggleSort(column: string) {
    setPageIndex(0)
    setSort(nextSort(activeSort, column))
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {title ? <span className='font-medium text-sm'>{title}</span> : null}

      <div className={cn('min-h-0 overflow-auto border-t bg-background', tableContainerClassName)}>
        <table className='w-full min-w-max border-collapse text-xs'>
          <thead className='sticky top-0 z-10 border-b bg-panel'>
            <tr>
              <th className='w-4 whitespace-nowrap px-3 py-2 text-center font-medium text-foreground shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none' />
              {resolvedColumns.map((column) => {
                const alignRight = numericColumns.has(column)
                const sortDirection = activeSort?.column === column ? activeSort.direction : null
                return (
                  <th
                    key={column}
                    aria-sort={
                      sortDirection
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className={cn(
                      'whitespace-nowrap px-3 py-2 font-medium text-foreground shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none',
                      alignRight && 'text-right tabular-nums'
                    )}
                  >
                    <button
                      type='button'
                      onClick={() => toggleSort(column)}
                      className='group flex w-full cursor-pointer items-center justify-between gap-3'
                    >
                      <span className={cn(alignRight && 'ml-auto')}>
                        {humanizeColumnLabels ? formatColumnLabel(column) : column}
                      </span>
                      <SortIndicator direction={sortDirection} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {hasRows ? (
              pageData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className='border-border/50 border-b bg-background last:border-b-0 hover:bg-accent/30'
                >
                  <td className='w-4 whitespace-nowrap bg-panel px-3 py-1 text-center align-top font-mono text-[11px] leading-5 shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none'>
                    <span className='px-1 py-2 font-[Geist] font-medium text-foreground'>
                      {pageIndex * pageSize + rowIndex + 1}
                    </span>
                  </td>
                  {resolvedColumns.map((column) => {
                    const value = row[column]
                    const isNull = value === null || value === undefined
                    const background = resolveColumnCellBackground(
                      conditionalFormats?.[column],
                      value,
                      columnRanges[column] ?? null
                    )
                    return (
                      <td
                        key={`${rowIndex}-${column}`}
                        style={{
                          minWidth: columnMinWidths[column],
                          ...(background ? { backgroundColor: background } : {}),
                        }}
                        className={cn(
                          'whitespace-nowrap px-3 py-1 align-top font-mono text-[11px] leading-5 shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none',
                          numericColumns.has(column) && 'text-right tabular-nums'
                        )}
                      >
                        {isNull ? (
                          <span className='text-muted-foreground/60 italic'>NULL</span>
                        ) : (
                          formatCellValue(value, dateFormat)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={resolvedColumns.length + 1}
                  className='px-3 py-6 text-center text-muted-foreground text-sm'
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPagination ? (
        compactFooter ? (
          <TablePaginationCompact
            totalRows={data.length}
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPageIndex}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPageIndex(0)
            }}
          />
        ) : (
          <TablePagination
            totalRows={data.length}
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPageIndex}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPageIndex(0)
            }}
          />
        )
      ) : showRowCount ? (
        <div
          className={cn('flex border-t px-4 py-2', compactFooter ? 'justify-start' : 'justify-end')}
        >
          <span className={cn('text-muted-foreground', compactFooter ? 'text-xs' : 'text-sm')}>
            {data.length} rows
          </span>
        </div>
      ) : null}
    </div>
  )
})

function SortIndicator({ direction }: { direction: SortDirection | null }) {
  return (
    <span className='-space-y-1 inline-flex shrink-0 flex-col'>
      <ChevronUp
        className={cn(
          'size-3',
          direction === 'asc' ? 'text-foreground' : 'text-muted-foreground/50'
        )}
      />
      <ChevronDown
        className={cn(
          'size-3',
          direction === 'desc' ? 'text-foreground' : 'text-muted-foreground/50'
        )}
      />
    </span>
  )
}

function nextSort(current: Sort | null, column: string): Sort | null {
  if (!current || current.column !== column) {
    return { column, direction: 'asc' }
  }
  if (current.direction === 'asc') {
    return { column, direction: 'desc' }
  }
  return null
}

function computeColumnMinWidths(
  data: TableRow[],
  columns: string[],
  dateFormat: typeof DEFAULT_DATE_FORMAT_SETTINGS
): Record<string, string> {
  const widths: Record<string, string> = {}
  for (const column of columns) {
    let maxChars = 0
    for (const row of data) {
      const chars = formatCellValue(row[column], dateFormat).length
      if (chars > maxChars) {
        maxChars = chars
      }
    }
    widths[column] = `calc(${maxChars}ch + 1.5rem)`
  }
  return widths
}

function computeFormattedColumnRanges(
  data: TableRow[],
  conditionalFormats?: ColumnConditionalFormats
): Record<string, ColumnRange | null> {
  if (!conditionalFormats) {
    return {}
  }

  const ranges: Record<string, ColumnRange | null> = {}
  for (const [column, rule] of Object.entries(conditionalFormats)) {
    if (isConditionalFormatRule(rule) && rule.type === 'color-scale') {
      ranges[column] = computeColumnRange(data, column)
    }
  }
  return ranges
}

function resolveColumnCellBackground(
  rule: ConditionalFormatRule | undefined,
  value: unknown,
  range: ColumnRange | null
): string | undefined {
  return isConditionalFormatRule(rule) ? resolveCellBackground(rule, value, range) : undefined
}

function inferColumns(data: TableRow[]): string[] {
  const seen = new Set<string>()
  const columns: string[] = []

  for (const row of data) {
    for (const column of Object.keys(row)) {
      if (seen.has(column)) {
        continue
      }
      seen.add(column)
      columns.push(column)
    }
  }

  return columns
}
