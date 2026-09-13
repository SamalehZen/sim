'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { EChartsOption } from 'echarts'
import { useParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { buildChartRenderOption } from '@/lib/charts/option'
import {
  CHART_ROWS_DEFAULT,
  CHART_ROWS_MAX,
  type ChartSpec,
  mapRowsToColumnNames,
  parseChartSpec,
  shapeTableRows,
} from '@/lib/charts/spec'
import { useTable, useTableRowsSample } from '@/hooks/queries/tables'

type EChartsModule = typeof import('echarts')

/**
 * HyperFix chat-light (Phase B) : rend un fence ```chart d'un message Luna.
 * Même contrat `.chart` que le file viewer (parseChartSpec + confinement
 * canvas), en version compacte pour le fil de discussion. Source `static`
 * prioritaire (lignes lues par Luna via ses outils) ; source `table`
 * supportée quand le workspaceId est résolvable (lecture live).
 */
export const ChatChart = memo(function ChatChart({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [echartsLib, setEchartsLib] = useState<EChartsModule | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params?.workspaceId

  useEffect(() => {
    let active = true
    import('echarts')
      .then((mod) => {
        if (active) setEchartsLib(mod)
      })
      .catch((e) => {
        if (active) setLoadError(getErrorMessage(e, 'failed to load the chart renderer'))
      })
    return () => {
      active = false
    }
  }, [])

  const { spec, error: parseError } = useMemo(() => parseChartSpec(content), [content])

  const tableSource = spec?.source?.type === 'table' ? spec.source : null
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

  const rows = useMemo(() => {
    if (!spec) return null
    if (spec.source?.type === 'static') return spec.source.rows ?? null
    if (!tableSource) return null
    const fetched = rowsQuery.data?.rows
    const columns = tableQuery.data?.schema.columns
    if (!fetched || !columns) return null
    return shapeTableRows(mapRowsToColumnNames(fetched, columns), tableSource)
  }, [spec, tableSource, rowsQuery.data, tableQuery.data])

  const option = useMemo(
    () =>
      spec
        ? (buildChartRenderOption({
            title: spec.title,
            option: spec.option,
            rows,
          }) as EChartsOption)
        : null,
    [spec, rows]
  )
  const optionKey = useMemo(() => (option ? JSON.stringify(option) : ''), [option])

  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setRenderError(null)
    const el = containerRef.current
    if (!el || !echartsLib || !option) return
    const chart = echartsLib.init(el, resolvedTheme === 'dark' ? 'dark' : undefined)
    try {
      chart.setOption(option)
    } catch (e) {
      setRenderError(getErrorMessage(e, 'invalid ECharts option'))
      chart.dispose()
      return
    }
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(el)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echartsLib, optionKey, resolvedTheme])

  const title = useMemo(() => {
    const parsed = parseChartTitle(spec)
    return parsed ?? 'chart'
  }, [spec])

  // En streaming, un JSON tronqué est normal : skeleton discret, pas d'erreur.
  if (parseError) {
    if (isStreaming) {
      return (
        <div
          data-testid='chat-chart-loading'
          className='not-prose my-4 h-[280px] w-full animate-pulse rounded-lg bg-[var(--surface-4)]'
        />
      )
    }
    return <ChatChartError message={parseError} content={content} title={title} />
  }
  if (loadError) return <ChatChartError message={loadError} content={content} title={title} />
  if (tableSource && !workspaceId) {
    return (
      <ChatChartError
        message='table source needs a workspace context'
        content={content}
        title={title}
      />
    )
  }
  if (tableSource && rowsQuery.isError) {
    return (
      <ChatChartError
        message={getErrorMessage(rowsQuery.error, 'failed to read the table')}
        content={content}
        title={title}
      />
    )
  }
  if (tableSource && tableQuery.isError) {
    return (
      <ChatChartError
        message={getErrorMessage(tableQuery.error, 'failed to read the table')}
        content={content}
        title={title}
      />
    )
  }

  const waitingOnRows = Boolean(tableSource) && rows === null

  return (
    <div
      data-testid='chat-chart'
      className='not-prose my-4 overflow-hidden rounded-lg border border-[var(--border)]'
    >
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-4 py-2'>
        <span className='text-[var(--text-tertiary)] text-xs'>{title}</span>
      </div>
      {renderError !== null && (
        <div className='border-[var(--border)] border-b bg-[var(--surface-5)] px-4 py-2 text-[var(--text-muted)] text-xs'>
          {renderError}
        </div>
      )}
      <div className={renderError !== null ? 'hidden' : 'relative w-full'}>
        {(!echartsLib || waitingOnRows) && (
          <div
            data-testid='chat-chart-loading'
            className='absolute inset-0 z-10 animate-pulse bg-[var(--surface-4)]'
          />
        )}
        <div ref={containerRef} className='aspect-[16/10] min-h-[280px] w-full' />
      </div>
    </div>
  )
})

function parseChartTitle(spec: ChartSpec | undefined): string | null {
  if (!spec) return null
  return typeof spec.title === 'string' && spec.title.trim() !== '' ? spec.title : null
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
