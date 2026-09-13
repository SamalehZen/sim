/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildChartRenderOption } from '@/lib/charts/option'
import { parseChartSpec } from '@/lib/charts/spec'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'

// Exemple canonique du skill visuel Luna (envelopes.ts CHART_SKILL) : le
// contrat prompt/renderer — ce que Luna émet doit passer le parseur du chat.
const SKILL_EXAMPLE = {
  schema_version: 1,
  title: 'Scores',
  source: { type: 'static', rows: [{ nom: 'Ada', score: 95 }] },
  option: {
    xAxis: { type: 'category' },
    yAxis: {},
    series: [{ type: 'bar', encode: { x: 'nom', y: 'score' } }],
  },
}

describe('chat chart contract', () => {
  it('parses the skill example as a valid .chart document', () => {
    const { spec, error } = parseChartSpec(JSON.stringify(SKILL_EXAMPLE))
    expect(error).toBeUndefined()
    expect(spec?.schema_version).toBe(1)
    expect(spec?.source?.type).toBe('static')
  })

  it('builds a render option from the skill example without throwing', () => {
    const { spec } = parseChartSpec(JSON.stringify(SKILL_EXAMPLE))
    expect(spec).toBeDefined()
    if (!spec) return
    const option = buildChartRenderOption({ title: spec.title, option: spec.option, rows: null })
    expect(option).toMatchObject({ backgroundColor: 'transparent' })
  })

  it('keeps a ```chart fence intact through chat sanitizing', () => {
    const message = `Voici les scores :\n\`\`\`chart\n${JSON.stringify(SKILL_EXAMPLE)}\n\`\`\`\n`
    expect(sanitizeChatDisplayContent(message)).toBe(message)
  })

  it('rejects a chart fence without schema_version', () => {
    const { spec, error } = parseChartSpec(JSON.stringify({ title: 'x', option: {} }))
    expect(spec).toBeUndefined()
    expect(error).toMatch(/schema_version/)
  })
})
