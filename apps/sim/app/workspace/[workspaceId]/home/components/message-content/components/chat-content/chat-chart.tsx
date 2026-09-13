'use client'

import { memo, useMemo, useState } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ChartColumn, Code, Download, List, Pencil } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import {
  DATE_RANGE_OPTIONS,
  type DateRange,
  filterByDateRange,
  sortByDateKey,
} from '@/lib/charts/nao/charts-utils'
import { resolveDataKey } from '@/lib/charts/nao/data-keys'
import * as displayChart from '@/lib/charts/nao/display-chart'
import {
  CHART_ROWS_DEFAULT,
  CHART_ROWS_MAX,
  mapRowsToColumnNames,
  shapeTableRows,
} from '@/lib/charts/spec'
import { downloadCsv, downloadXlsx, tableToCsv } from '@/lib/table-export'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'
import { ChartConfigEditDialog, type EditableChartInput } from '../chart-display/chart-edit-dialog'
import { ChartRangeSelector } from '../chart-display/chart-range-selector'
import { ChartDisplay } from '../chart-display/chart-view'
import { TableDisplay } from '../chart-display/display-table'

type ViewMode = 'chart' | 'data' | 'query'

/**
 * HyperFix chat-light (Phase B2) : bloc graphique du chat, comportement nao
 * (`DisplayChartToolCall`) — vues chart/data/query, export CSV/XLSX.
 * Le fence ```chart porte un JSON display_chart (contrat lib/charts/nao).
 * PNG (B2-c), édition (B2-d) et add-to-story (B2-e) arrivent ensuite.
 */
export const ChatChart = memo(function ChatChart({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [dataRange, setDataRange] = useState<DateRange>('all')
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params?.workspaceId

  const parsed: { input: displayChart.Input } | { error: string } = useMemo(() => {
    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'not valid JSON' } as const
    }
    const result = displayChart.InputSchema.safeParse(raw)
    if (!result.success) {
      return { error: result.error.issues[0]?.message ?? 'invalid chart input' } as const
    }
    return { input: result.data } as const
  }, [content])

  const tableSource =
    parsed && 'input' in parsed && parsed.input.source.type === 'table' ? parsed.input.source : null
  const rowsQuery = useTableRowsSample({
    workspaceId: workspaceId ?? '',
    tableId: tableSource?.tableId,
    filter: tableSource?.filter,
    sort: tableSource?.sort,
    limit: Math.min(tableSource?.limit ?? CHART_ROWS_DEFAULT, CHART_ROWS_MAX),
    enabled: Boolean(tableSource && workspaceId),
  })
  const tableQuery = useTable(
    tableSource && workspaceId ? workspaceId : undefined,
    tableSource?.tableId
  )

  const staticRows = useMemo(() => {
    if (!parsed || !('input' in parsed)) return null
    return parsed.input.source.type === 'static' ? (parsed.input.source.rows ?? null) : null
  }, [parsed])

  const sourceRows = useMemo(() => {
    if (staticRows) return staticRows as Record<string, unknown>[]
    if (!tableSource) return null
    const fetched = rowsQuery.data?.rows
    const columns = tableQuery.data?.schema.columns
    if (!fetched || !columns) return null
    return shapeTableRows(mapRowsToColumnNames(fetched, columns), {
      type: 'table',
      tableId: tableSource.tableId,
    }) as Record<string, unknown>[]
  }, [staticRows, tableSource, rowsQuery.data, tableQuery.data])

  // Le rendu est assuré par ChartDisplay (recharts) ; la validation du
  // fence est faite par InputSchema ci-dessus.
  if (!parsed || !('input' in parsed)) {
    const message = !parsed ? 'invalid chart' : parsed.error
    if (isStreaming) {
      return (
        <div
          data-testid='chat-chart-loading'
          className='not-prose my-4 h-[280px] w-full animate-pulse rounded-lg bg-[var(--surface-4)]'
        />
      )
    }
    return <ChatChartError message={message} content={content} title='chart' />
  }

  const input = parsed.input
  const isTableVariant = input.chart_type === 'table'

  if (tableSource && !workspaceId) {
    return (
      <ChatChartError
        message='table source needs a workspace context'
        content={content}
        title={input.title ?? 'chart'}
      />
    )
  }
  if (tableSource && rowsQuery.isError) {
    const message =
      rowsQuery.error instanceof Error ? rowsQuery.error.message : 'failed to read the table'
    return <ChatChartError message={message} content={content} title={input.title ?? 'chart'} />
  }
  if (tableSource && tableQuery.isError) {
    const message =
      tableQuery.error instanceof Error ? tableQuery.error.message : 'failed to read the table'
    return <ChatChartError message={message} content={content} title={input.title ?? 'chart'} />
  }

  return (
    <ChatChartBody
      input={input}
      rows={sourceRows}
      waitingOnRows={Boolean(tableSource) && sourceRows === null}
      viewMode={viewMode}
      setViewMode={setViewMode}
      dataRange={dataRange}
      setDataRange={setDataRange}
      content={content}
      isTableVariant={isTableVariant}
      workspaceId={workspaceId ?? ''}
    />
  )
})

async function downloadChartPng(
  workspaceId: string,
  input: displayChart.Input,
  rows: Record<string, unknown>[],
  title: string
): Promise<void> {
  const response = await fetch('/api/charts/png', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, input, rows: rows.slice(0, 2000) }),
  })
  if (!response.ok) {
    throw new Error(`PNG export failed (${response.status})`)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'chart'}.png`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ChatChartBody({
  input: inputProp,
  rows,
  waitingOnRows,
  viewMode,
  setViewMode,
  dataRange,
  setDataRange,
  content,
  isTableVariant,
  workspaceId,
}: {
  input: displayChart.Input
  rows: Record<string, unknown>[] | null
  waitingOnRows: boolean
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  dataRange: DateRange
  setDataRange: (range: DateRange) => void
  content: string
  isTableVariant: boolean
  workspaceId: string
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editedInput, setEditedInput] = useState<displayChart.Input | null>(null)
  const input = editedInput ?? inputProp
  const title = input.title ?? 'chart'

  const handleDownloadPng = async () => {
    if (!rows || rows.length === 0) return
    setIsDownloading(true)
    setDownloadError(null)
    try {
      await downloadChartPng(workspaceId, input, rows, title)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'PNG export failed')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleSaveEdit = async (next: EditableChartInput) => {
    setIsSavingEdit(true)
    setEditError(null)
    try {
      const newFence = `\`\`\`chart\n${JSON.stringify(next)}\n\`\`\``
      const response = await fetch('/api/charts/fence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, oldFence: content, newFence }),
      })
      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`)
      }
      setEditedInput(next)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Save failed')
      throw error
    } finally {
      setIsSavingEdit(false)
    }
  }

  if (isTableVariant && displayChart.isTableInput(input)) {
    if (!rows) {
      return waitingOnRows ? (
        <div
          data-testid='chat-chart-loading'
          className='not-prose my-4 h-[200px] w-full animate-pulse rounded-lg bg-[var(--surface-4)]'
        />
      ) : (
        <div className='my-2 text-[var(--text-secondary)] text-sm'>
          Could not display the table because the data is missing.
        </div>
      )
    }
    return (
      <div
        data-testid='chat-chart'
        className='not-prose my-4 overflow-hidden rounded-lg border border-[var(--border)]'
      >
        <ChartHeader
          title={title}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showQueryView
          rows={rows}
        />
        {viewMode === 'query' ? (
          <QueryView input={input} />
        ) : (
          <TableDisplay
            data={rows}
            tableContainerClassName='max-h-80 rounded-none border-0 bg-transparent'
            maxRowsBeforePagination={10}
            compactFooter
            conditionalFormats={input.conditional_formats}
          />
        )}
      </div>
    )
  }

  if (!displayChart.isChartInput(input)) {
    return <ChatChartError message='invalid chart input' content={content} title={title} />
  }

  if (input.series.length === 0) {
    return (
      <div className='my-2 text-[var(--text-secondary)] text-sm'>
        Could not display the chart because no series are configured.
      </div>
    )
  }
  if (!rows) {
    return waitingOnRows ? (
      <div
        data-testid='chat-chart-loading'
        className='not-prose my-4 h-[280px] w-full animate-pulse rounded-lg bg-[var(--surface-4)]'
      />
    ) : (
      <div className='my-2 text-[var(--text-secondary)] text-sm'>
        Could not display the chart because the data is missing.
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className='my-2 text-[var(--text-secondary)] text-sm'>
        Could not display the chart because the data is empty.
      </div>
    )
  }

  const columns = Object.keys(rows[0] ?? {})
  const showRange = !displayChart.isPieChart(input.chart_type) && input.x_axis_type === 'date'
  const filteredRows = filterRows(rows, input.x_axis_key, input.x_axis_type, dataRange)

  return (
    <div
      data-testid='chat-chart'
      className={cn(
        'group/chart not-prose relative my-4 flex flex-col items-stretch gap-2 overflow-hidden rounded-lg border border-[var(--border)] px-3'
      )}
    >
      <div className='flex w-full items-center justify-between py-2'>
        <div className='flex items-center gap-1'>
          <span className='flex-1 font-medium text-sm'>{title}</span>
          {showRange && (
            <ChartRangeSelector
              options={DATE_RANGE_OPTIONS}
              selectedRange={dataRange}
              onRangeSelected={(range: DateRange) => setDataRange(range)}
            />
          )}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <div className='flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/chart:opacity-100'>
            <ViewButton
              active={viewMode === 'chart'}
              onClick={() => setViewMode('chart')}
              title='View chart'
            >
              <ChartColumn className='size-3' />
            </ViewButton>
            <ViewButton
              active={viewMode === 'data'}
              onClick={() => setViewMode('data')}
              title='View data'
            >
              <List className='size-3' />
            </ViewButton>
            <ViewButton
              active={viewMode === 'query'}
              onClick={() => setViewMode('query')}
              title='View query'
            >
              <Code className='size-3' />
            </ViewButton>
            {viewMode === 'chart' ? (
              <Button
                variant='ghost'
                size='icon'
                className='rounded-full'
                onClick={() => void handleDownloadPng()}
                disabled={isDownloading}
                title='Download as PNG'
              >
                <Download className='size-3' />
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon' className='rounded-full' title='Export data'>
                    <Download className='size-3' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    onSelect={() => downloadCsv(`${title}.csv`, tableToCsv(columns, rows))}
                  >
                    CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void downloadXlsx(`${title}.xlsx`, columns, rows)}
                  >
                    Excel (XLSX)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {downloadError && (
            <span className='text-[var(--text-error)] text-xs' role='alert'>
              {downloadError}
            </span>
          )}
          {editError && (
            <span className='text-[var(--text-error)] text-xs' role='alert'>
              {editError}
            </span>
          )}
          {displayChart.isBuiltinChartType(input.chart_type) && (
            <Button
              variant='ghost'
              size='icon'
              className='rounded-full'
              onClick={() => {
                setEditError(null)
                setIsEditOpen(true)
              }}
              title='Edit chart'
            >
              <Pencil className='size-3' />
            </Button>
          )}
          {editError && (
            <span className='text-[var(--text-error)] text-xs' role='alert'>
              {editError}
            </span>
          )}
        </div>
      </div>

      {viewMode === 'data' ? (
        <TableDisplay
          data={rows}
          tableContainerClassName='max-h-80 rounded-none border-0 bg-transparent'
          maxRowsBeforePagination={10}
          compactFooter
        />
      ) : viewMode === 'query' ? (
        <QueryView input={input} />
      ) : !displayChart.isBuiltinChartType(input.chart_type) ? (
        <div className='my-2 text-[var(--text-secondary)] text-sm'>
          Custom chart “{input.chart_type}” can only be configured by Luna — re-ask her to change
          it.
        </div>
      ) : (
        <ChartDisplay
          data={filteredRows}
          chartType={input.chart_type}
          xAxisKey={input.x_axis_key ?? ''}
          series={input.series}
          xAxisType={input.x_axis_type === 'number' ? 'number' : 'category'}
          xAxisLabel={input.x_axis_label}
          title={undefined}
          yAxisMin={input.y_axis_min}
          yAxisMax={input.y_axis_max}
          yAxisLabel={input.y_axis_label}
          yAxisRightMin={input.y_axis_right_min}
          yAxisRightMax={input.y_axis_right_max}
          yAxisRightLabel={input.y_axis_right_label}
          showDataLabels={input.show_data_labels}
          comparisonMode={'comparison_mode' in input ? input.comparison_mode : undefined}
          hideTotal={input.hide_total}
        />
      )}
      {displayChart.isBuiltinChartType(input.chart_type) && (
        <ChartConfigEditDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          config={{ ...input, chart_type: input.chart_type }}
          availableColumns={columns}
          data={rows}
          onSave={handleSaveEdit}
          isSaving={isSavingEdit}
          description='Tweak the chart parameters. Changes are saved to the chat.'
        />
      )}
    </div>
  )
}

function filterRows(
  rows: Record<string, unknown>[],
  xAxisKey: string | null | undefined,
  xAxisType: string | null | undefined,
  dataRange: DateRange
): Record<string, unknown>[] {
  if (xAxisType !== 'date') return rows
  const resolved = resolveDataKey(rows, xAxisKey ?? '')
  const sorted = sortByDateKey(rows, resolved)
  return filterByDateRange(sorted, resolved, dataRange)
}

function ChartHeader({
  title,
  viewMode,
  setViewMode,
  showQueryView,
  rows,
}: {
  title: string
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  showQueryView: boolean
  rows: Record<string, unknown>[]
}) {
  const columns = Object.keys(rows[0] ?? {})
  return (
    <div className='flex w-full items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2'>
      <span className='flex-1 font-medium text-sm'>{title}</span>
      <div className='flex shrink-0 items-center gap-1'>
        <ViewButton
          active={viewMode === 'chart'}
          onClick={() => setViewMode('chart')}
          title='View chart'
        >
          <ChartColumn className='size-3' />
        </ViewButton>
        <ViewButton
          active={viewMode === 'data'}
          onClick={() => setViewMode('data')}
          title='View data'
        >
          <List className='size-3' />
        </ViewButton>
        {showQueryView && (
          <ViewButton
            active={viewMode === 'query'}
            onClick={() => setViewMode('query')}
            title='View query'
          >
            <Code className='size-3' />
          </ViewButton>
        )}
        {viewMode !== 'chart' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='rounded-full' title='Export data'>
                <Download className='size-3' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem
                onSelect={() => downloadCsv(`${title}.csv`, tableToCsv(columns, rows))}
              >
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadXlsx(`${title}.xlsx`, columns, rows)}>
                Excel (XLSX)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant='ghost'
      size='icon'
      className={cn('rounded-full', active ? 'bg-[var(--surface-5)]' : '')}
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  )
}

/** Équivalent nao du "View SQL query" : descripteur de la source Sim (table + filtre). */
function QueryView({ input }: { input: displayChart.Input }) {
  const descriptor =
    input.source.type === 'table'
      ? {
          table: input.source.tableId,
          ...(input.source.filter !== undefined ? { filter: input.source.filter } : {}),
          ...(input.source.sort !== undefined ? { sort: input.source.sort } : {}),
          ...(input.source.limit !== undefined ? { limit: input.source.limit } : {}),
        }
      : { staticRows: Array.isArray(input.source.rows) ? input.source.rows.length : 0 }
  return (
    <div className='max-h-80 overflow-auto py-2'>
      <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] leading-[1.6]'>
        <code>{JSON.stringify(descriptor, null, 2)}</code>
      </pre>
    </div>
  )
}

function ChatChartError({
  message,
  content,
  title,
}: {
  message: string
  content: string
  title: string
}) {
  return (
    <div
      data-testid='chat-chart-error'
      className='not-prose my-4 overflow-hidden rounded-lg border border-[var(--border)]'
    >
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-4 py-2'>
        <span className='text-[var(--text-tertiary)] text-xs'>{title}</span>
        <span className='text-[var(--text-muted)] text-xs'>{message}</span>
      </div>
      <div className='code-editor-theme bg-[var(--surface-5)]'>
        <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] text-[var(--text-primary)] leading-[1.6]'>
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}
