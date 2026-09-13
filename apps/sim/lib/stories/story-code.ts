/**
 * HyperFix chat-light (Phase C) : code des stories — extraction et validation
 * des blocs embarqués, inspiré de nao (`story-segments.ts`, `story-validation.ts`).
 * ADAPTATION : les blocs portent un JSON display_chart complet (contrat
 * lib/charts/nao), pas de `query_id` SQL.
 *
 * Formats :
 *   <chart>{"source":..., "chart_type":"bar", ...}</chart>
 *   <table>{"source":..., "chart_type":"table", ...}</table>
 *   <grid widths="2,1">...</grid>  (2-4 blocs chart/table côte à côte)
 *   <tab title="...">...</tab>
 */

import type { Input as ChartInput } from '@/lib/charts/nao/display-chart'
import { InputSchema } from '@/lib/charts/nao/display-chart'

export interface StoryChartBlock {
  kind: 'chart' | 'table'
  input: ChartInput
  start: number
  end: number
}

interface RawBlock {
  kind: 'chart' | 'table'
  json: string
  start: number
  end: number
}

const CHART_BLOCK_RE = /<chart>([\s\S]*?)<\/chart>/g
const TABLE_BLOCK_RE = /<table>([\s\S]*?)<\/table>/g

function extractRawBlocks(code: string): RawBlock[] {
  const blocks: RawBlock[] = []
  for (const match of code.matchAll(CHART_BLOCK_RE)) {
    blocks.push({
      kind: 'chart',
      json: match[1],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  for (const match of code.matchAll(TABLE_BLOCK_RE)) {
    blocks.push({
      kind: 'table',
      json: match[1],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  return blocks.sort((a, b) => a.start - b.start)
}

/** Valide le code : chaque bloc doit être un JSON display_chart valide du bon type. */
export function validateStoryCode(
  code: string
): { ok: true; blocks: StoryChartBlock[] } | { ok: false; error: string } {
  if (code.length > 200000) {
    return { ok: false, error: 'Story code exceeds 200000 characters' }
  }
  const blocks: StoryChartBlock[] = []
  for (const block of extractRawBlocks(code)) {
    let json: unknown
    try {
      json = JSON.parse(block.json.trim())
    } catch {
      return { ok: false, error: `Invalid JSON in <${block.kind}> block` }
    }
    const parsed = InputSchema.safeParse(json)
    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid <${block.kind}> block: ${parsed.error.issues[0]?.message ?? 'invalid input'}`,
      }
    }
    if (block.kind === 'chart' && parsed.data.chart_type === 'table') {
      return { ok: false, error: 'A <chart> block must not use chart_type "table"' }
    }
    if (block.kind === 'table' && parsed.data.chart_type !== 'table') {
      return { ok: false, error: 'A <table> block must use chart_type "table"' }
    }
    blocks.push({ kind: block.kind, input: parsed.data, start: block.start, end: block.end })
  }
  return { ok: true, blocks }
}

/** Construit un bloc <chart> depuis un Input (B2-e add-to-story). */
export function buildStoryChartBlock(input: ChartInput): string {
  return `<chart>${JSON.stringify(input)}</chart>`
}

/** Construit un bloc <table> depuis un Input table. */
export function buildStoryTableBlock(input: ChartInput): string {
  return `<table>${JSON.stringify(input)}</table>`
}
