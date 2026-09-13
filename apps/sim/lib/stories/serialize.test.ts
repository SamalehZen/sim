/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseStorySegments } from '@/lib/stories/segments'
import { serializeStorySegments } from '@/lib/stories/serialize'

const CHART_JSON = JSON.stringify({
  source: { type: 'static', rows: [{ nom: 'Ada', score: 95 }] },
  chart_type: 'bar',
  x_axis_key: 'nom',
  x_axis_type: 'category',
  series: [{ data_key: 'score' }],
  title: 'Scores',
})

describe('serializeStorySegments', () => {
  it('round-trips markdown + chart + grid + tabs', () => {
    const code = `# Titre\n<chart>${CHART_JSON}</chart>\n<grid widths="2,1"><chart>${CHART_JSON}</chart><chart>${CHART_JSON}</chart></grid>\n<tab title="A">texte</tab><tab title="B & C">autre</tab>\n`
    const back = serializeStorySegments(parseStorySegments(code))
    expect(parseStorySegments(back).map((s) => s.kind)).toEqual(
      parseStorySegments(code).map((s) => s.kind)
    )
    const reparsed = parseStorySegments(back)
    const tabs = reparsed.find((s) => s.kind === 'tabs')
    if (tabs?.kind !== 'tabs') throw new Error('expected tabs')
    expect(tabs.tabs.map((t) => t.title)).toEqual(['A', 'B & C'])
    const countCharts = (segments: typeof reparsed): number =>
      segments.reduce(
        (n, s) =>
          n +
          (s.kind === 'chart' ? 1 : 0) +
          (s.kind === 'grid' ? countCharts(s.children) : 0) +
          (s.kind === 'tabs' ? s.tabs.reduce((m, t) => m + countCharts(t.children), 0) : 0),
        0
      )
    expect(countCharts(reparsed)).toBe(3)
  })

  it('serializes an edited markdown segment', () => {
    const segments = parseStorySegments('# Avant')
    if (segments[0]?.kind !== 'markdown') throw new Error('expected markdown')
    segments[0].text = '# Après'
    expect(serializeStorySegments(segments)).toBe('# Après')
  })
})
