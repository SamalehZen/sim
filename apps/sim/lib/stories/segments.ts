/**
 * HyperFix chat-light (Phase C) : segmentation du code story en blocs
 * rendables, inspiré de nao (`story-segments.ts`).
 * Blocs : <chart>{json}</chart>, <table>{json}</table>,
 * <grid widths="2,1">...</grid>, <tab title="...">...</tab>.
 */

import type { Input as ChartInput } from '@/lib/charts/nao/display-chart'
import { InputSchema } from '@/lib/charts/nao/display-chart'

export type StorySegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; input: ChartInput }
  | { kind: 'table'; input: ChartInput }
  | { kind: 'grid'; widths: number[]; children: StorySegment[] }
  | { kind: 'tabs'; tabs: { title: string; children: StorySegment[] }[] }

const BLOCK_RE = /<(chart|table|grid|tab)(\s[^>]*)?>([\s\S]*?)<\/\1>/g

function parseAttrs(attrString: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!attrString) return attrs
  for (const match of attrString.matchAll(/(\w+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function parseBlockJson(kind: string, json: string): ChartInput | null {
  let raw: unknown
  try {
    raw = JSON.parse(json.trim())
  } catch {
    return null
  }
  const parsed = InputSchema.safeParse(raw)
  if (!parsed.success) return null
  if (kind === 'chart' && parsed.data.chart_type === 'table') return null
  if (kind === 'table' && parsed.data.chart_type !== 'table') return null
  return parsed.data
}

/** Découpe le code en segments (récursif pour grid/tabs). */
export function parseStorySegments(code: string): StorySegment[] {
  const segments: StorySegment[] = []
  let cursor = 0
  for (const match of code.matchAll(BLOCK_RE)) {
    const index = match.index ?? 0
    if (index > cursor) {
      const text = code.slice(cursor, index)
      if (text.trim() !== '') segments.push({ kind: 'markdown', text })
    }
    cursor = index + match[0].length
    const [, tag, attrString, inner] = match
    if (tag === 'chart' || tag === 'table') {
      const input = parseBlockJson(tag, inner)
      if (input) {
        segments.push({ kind: tag, input })
      } else {
        segments.push({ kind: 'markdown', text: match[0] })
      }
    } else if (tag === 'grid') {
      const attrs = parseAttrs(attrString)
      const widths = (attrs.widths ?? '')
        .split(',')
        .map((w) => Number.parseInt(w.trim(), 10))
        .filter((w) => Number.isFinite(w) && w > 0)
      segments.push({ kind: 'grid', widths, children: parseStorySegments(inner) })
    } else if (tag === 'tab') {
      segments.push({
        kind: 'tabs',
        tabs: [
          { title: parseAttrs(attrString).title ?? 'Tab', children: parseStorySegments(inner) },
        ],
      })
    }
  }
  if (cursor < code.length) {
    const text = code.slice(cursor)
    if (text.trim() !== '') segments.push({ kind: 'markdown', text })
  }
  return mergeAdjacentTabs(mergeAdjacentMarkdown(segments))
}

function mergeAdjacentMarkdown(segments: StorySegment[]): StorySegment[] {
  const out: StorySegment[] = []
  for (const segment of segments) {
    const prev = out[out.length - 1]
    if (segment.kind === 'markdown' && prev?.kind === 'markdown') {
      prev.text += segment.text
    } else {
      out.push(segment)
    }
  }
  return out
}

/** Les <tab> adjacents forment un seul groupe d'onglets. */
function mergeAdjacentTabs(segments: StorySegment[]): StorySegment[] {
  const out: StorySegment[] = []
  for (const segment of segments) {
    const prev = out[out.length - 1]
    if (segment.kind === 'tabs' && prev?.kind === 'tabs') {
      prev.tabs.push(...segment.tabs)
    } else {
      out.push(segment)
    }
  }
  return out
}
