/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildEnvelopes,
  LUNA_MODEL,
  LUNA_WORKFLOW_NAME,
  translateAgentEvent,
} from '@/lib/copilot/luna/envelopes'

const stream = { streamId: 's1', chatId: 'c1' }
const trace = { requestId: 'r1' }

describe('boucle Luna locale', () => {
  it('force le modèle Luna et le nom de workflow technique', () => {
    expect(LUNA_MODEL).toBe('experiential/gpt-5.6-luna')
    expect(LUNA_WORKFLOW_NAME).toBe('Luna Chat')
  })

  it('traduit texte/thinking/outils vers enveloppes UI', () => {
    const env = buildEnvelopes(stream, trace)
    expect(translateAgentEvent(env, { type: 'text_delta', text: 'bonjour' })).toMatchObject({
      type: 'text',
      payload: { channel: 'assistant', text: 'bonjour' },
    })
    expect(
      translateAgentEvent(env, { type: 'text_delta', text: '...', turn: 'pending' })
    ).toMatchObject({ type: 'text' })
    expect(
      translateAgentEvent(env, { type: 'thinking_delta', text: 'je réfléchis' })
    ).toMatchObject({
      type: 'text',
      payload: { channel: 'thinking', text: 'je réfléchis' },
    })
    expect(
      translateAgentEvent(env, { type: 'tool_call_start', id: 't1', name: 'gmail_read' })
    ).toMatchObject({ type: 'tool', payload: { phase: 'call', executor: 'sim' } })
    expect(
      translateAgentEvent(env, {
        type: 'tool_call_end',
        id: 't1',
        name: 'gmail_read',
        status: 'success',
      })
    ).toMatchObject({ type: 'tool', payload: { phase: 'result', status: 'success' } })
  })

  it('ignore les frontières internes turn_end', () => {
    const env = buildEnvelopes(stream, trace)
    expect(translateAgentEvent(env, { type: 'turn_end', turn: 'final' })).toBeNull()
    expect(translateAgentEvent(env, { type: 'turn_end', turn: 'intermediate' })).toBeNull()
  })

  it('numérote les enveloppes en séquence', () => {
    const env = buildEnvelopes(stream, trace)
    const a = translateAgentEvent(env, { type: 'text_delta', text: 'a' })
    const b = translateAgentEvent(env, { type: 'text_delta', text: 'b' })
    expect(a).toMatchObject({ seq: 1 })
    expect(b).toMatchObject({ seq: 2 })
    expect(env.complete('complete')).toMatchObject({
      type: 'complete',
      seq: 3,
      payload: { status: 'complete', model: LUNA_MODEL },
    })
  })
})
