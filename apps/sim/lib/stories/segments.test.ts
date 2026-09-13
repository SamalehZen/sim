/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseStorySegments } from '@/lib/stories/segments'

const CHART_JSON = JSON.stringify({
  source: { type: 'static', rows: [{ nom: 'Ada', score: 95 }] },
  chart_type: 'bar',
  x_axis_key: 'nom',
  x_axis_type: 'category',
  series: [{ data_key: 'score' }],
  title: 'Scores',
})

describe('parseStorySegments', () => {
  it('parses markdown + chart blocks', () => {
    const segments = parseStorySegments(`# Titre\n<chart>${CHART_JSON}</chart>\nFin`)
    expect(segments.map((s) => s.kind)).toEqual(['markdown', 'chart', 'markdown'])
    const chart = segments[1]
    if (chart.kind !== 'chart') throw new Error('expected chart')
    expect(chart.input.title).toBe('Scores')
  })

  it('groups adjacent tabs', () => {
    const segments = parseStorySegments(
      `<tab title="A"><chart>${CHART_JSON}</chart></tab><tab title="B">texte</tab>`
    )
    expect(segments.map((s) => s.kind)).toEqual(['tabs'])
    const tabs = segments[0]
    if (tabs.kind !== 'tabs') throw new Error('expected tabs')
    expect(tabs.tabs.map((t) => t.title)).toEqual(['A', 'B'])
  })

  it('parses grid children recursively', () => {
    const segments = parseStorySegments(
      `<grid widths="2,1"><chart>${CHART_JSON}</chart><chart>${CHART_JSON}</chart></grid>`
    )
    expect(segments.map((s) => s.kind)).toEqual(['grid'])
    const grid = segments[0]
    if (grid.kind !== 'grid') throw new Error('expected grid')
    expect(grid.widths).toEqual([2, 1])
    expect(grid.children.map((c) => c.kind)).toEqual(['chart', 'chart'])
  })

  it('keeps invalid blocks as markdown', () => {
    const segments = parseStorySegments('<chart>pas du json</chart>')
    expect(segments.map((s) => s.kind)).toEqual(['markdown'])
  })
})
