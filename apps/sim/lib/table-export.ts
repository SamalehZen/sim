/**
 * HyperFix chat-light (Phase B2) : export CSV/XLSX des données de graphique,
 * porté depuis nao (`apps/frontend/src/lib/table-export.ts`).
 * ADAPTATION : format de dates = défaut européen (pas de réglages projet).
 */

import type { Cell, Row } from 'write-excel-file/universal'
import writeXlsxFile from 'write-excel-file/universal'
import type { DateFormatSettings } from '@/lib/charts/nao/date'
import { DEFAULT_DATE_FORMAT_SETTINGS } from '@/lib/charts/nao/date'
import { formatCellValue } from '@/lib/charts/nao/story-table-utils'

export type DataExportFormat = 'csv' | 'xlsx'

type TableRow = Record<string, unknown>

const neutralizeFormula = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

const escapeCsvCell = (value: string) => {
  const safe = neutralizeFormula(value)
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function tableToCsv(
  columns: string[],
  rows: TableRow[],
  dateFormat: DateFormatSettings | null = DEFAULT_DATE_FORMAT_SETTINGS
): string {
  return [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      columns.map((column) => escapeCsvCell(formatCellValue(row[column], dateFormat))).join(',')
    ),
  ].join('\n')
}

function tableToXlsxBlob(
  columns: string[],
  rows: TableRow[],
  dateFormat: DateFormatSettings | null
): Promise<Blob> {
  const header: Row = columns.map((column) => ({ value: column, fontWeight: 'bold' }))
  const body: Row[] = rows.map((row) =>
    columns.map((column) => toXlsxCell(row[column], dateFormat))
  )
  return writeXlsxFile([header, ...body]).toBlob()
}

function toXlsxCell(value: unknown, dateFormat: DateFormatSettings | null): Cell {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { type: Number, value } : null
  }
  if (typeof value === 'boolean') {
    return { type: Boolean, value }
  }
  return { type: String, value: formatCellValue(value, dateFormat) }
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename: string, csv: string): void {
  triggerDownload(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
}

export async function downloadXlsx(
  filename: string,
  columns: string[],
  rows: TableRow[],
  dateFormat: DateFormatSettings | null = DEFAULT_DATE_FORMAT_SETTINGS
): Promise<void> {
  triggerDownload(filename, await tableToXlsxBlob(columns, rows, dateFormat))
}
