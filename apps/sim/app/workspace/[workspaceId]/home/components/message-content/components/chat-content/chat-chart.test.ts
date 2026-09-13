/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as displayChart from '@/lib/charts/nao/display-chart'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'

// Exemple canonique du skill visuel Luna (envelopes.ts CHART_SKILL) : le
// contrat prompt/renderer — ce que Luna émet doit passer le schéma nao.
const SKILL_EXAMPLE = {
  source: { type: 'static', rows: [{ nom: 'Ada', score: 95 }] },
  chart_type: 'bar',
  x_axis_key: 'nom',
  x_axis_type: 'category',
  series: [{ data_key: 'score', label: 'Score' }],
  title: 'Scores',
}

describe('chat chart contract', () => {
  it('parses the skill example as a valid display_chart input', () => {
    const result = displayChart.InputSchema.safeParse(SKILL_EXAMPLE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(displayChart.isChartInput(result.data)).toBe(true)
  })

  it('keeps a ```chart fence intact through chat sanitizing', () => {
    const message = `Voici les scores :\n\`\`\`chart\n${JSON.stringify(SKILL_EXAMPLE)}\n\`\`\`\n`
    expect(sanitizeChatDisplayContent(message)).toBe(message)
  })

  it('rejects a chart fence without series', () => {
    const { chart_type, ...withoutSeries } = { ...SKILL_EXAMPLE, series: [] as never[] }
    void chart_type
    const result = displayChart.InputSchema.safeParse(withoutSeries)
    expect(result.success).toBe(false)
  })

  it('accepts a live table source', () => {
    const result = displayChart.InputSchema.safeParse({
      ...SKILL_EXAMPLE,
      source: { type: 'table', tableId: 'tbl_abc' },
    })
    expect(result.success).toBe(true)
  })
})
