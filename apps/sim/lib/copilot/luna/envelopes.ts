/**
 * HyperFix chat-light : traduction protocole agent-events-v1 -> enveloppes UI.
 * Module pur (aucun import lourd) pour rester testable unitairement.
 */

import type {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1StreamRef,
  MothershipStreamV1Trace,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { ContextePack } from '@/lib/copilot/luna/context-pack'
import type { StreamEvent } from '@/lib/copilot/request/session/contract'
import type { AgentStreamEvent } from '@/providers/stream-events'

/** Modèle unique du workspace chat en mode chat-light. */
export const LUNA_MODEL = 'experiential/gpt-5.6-luna'

/** Nom du workflow technique provisionné par workspace (invisible : section Workflows masquée). */
export const LUNA_WORKFLOW_NAME = 'Luna Chat'

export interface LunaEnvelopes {
  text: (channel: 'assistant' | 'thinking', text: string) => StreamEvent
  toolCall: (id: string, name: string) => StreamEvent
  toolResult: (id: string, name: string, status: 'success' | 'error' | 'cancelled') => StreamEvent
  complete: (status: MothershipStreamV1CompletionStatus) => StreamEvent
}

export function buildEnvelopes(
  stream: MothershipStreamV1StreamRef,
  trace: MothershipStreamV1Trace
): LunaEnvelopes {
  let seq = 0
  const now = () => new Date().toISOString()
  const nextSeq = () => {
    seq += 1
    return seq
  }
  return {
    text: (channel, text) =>
      ({
        type: 'text',
        payload: { channel, text },
        seq: nextSeq(),
        stream,
        trace,
        ts: now(),
        v: 1,
      }) as StreamEvent,
    toolCall: (id, name) =>
      ({
        type: 'tool',
        payload: {
          phase: 'call',
          executor: 'sim',
          mode: 'sync',
          toolCallId: id,
          toolName: name,
          status: 'executing',
        },
        seq: nextSeq(),
        stream,
        trace,
        ts: now(),
        v: 1,
      }) as StreamEvent,
    toolResult: (id, name, status) =>
      ({
        type: 'tool',
        payload: {
          phase: 'result',
          executor: 'sim',
          mode: 'sync',
          toolCallId: id,
          toolName: name,
          status,
        },
        seq: nextSeq(),
        stream,
        trace,
        ts: now(),
        v: 1,
      }) as unknown as StreamEvent,
    complete: (status) =>
      ({
        type: 'complete',
        payload: { status, model: LUNA_MODEL },
        seq: nextSeq(),
        stream,
        trace,
        ts: now(),
        v: 1,
      }) as StreamEvent,
  }
}

/**
 * Traduit un événement agent vers l'enveloppe UI. Retourne null pour les
 * frontières internes (turn_end) qui ne s'affichent pas.
 */
export function translateAgentEvent(
  env: LunaEnvelopes,
  event: AgentStreamEvent
): StreamEvent | null {
  if (event.type === 'text_delta') {
    // Le contrat demande aux sinks d'afficher le live, y compris 'pending'.
    return env.text('assistant', event.text)
  }
  if (event.type === 'thinking_delta') {
    return env.text('thinking', event.text)
  }
  if (event.type === 'tool_call_start') {
    return env.toolCall(event.id, event.name)
  }
  if (event.type === 'tool_call_end') {
    return env.toolResult(event.id, event.name, event.status)
  }
  return null
}

/**
 * HyperFix chat-light (Phase B) : skill visuels. Apprend à Luna le langage
 * graphique du chat : un fence ```chart contenant un document `.chart`
 * (contrat lib/charts/spec), rendu en ECharts côté UI.
 */
const CHART_SKILL = [
  'Graphiques : quand des nombres se comparent mieux en image (parts, evolution, classement),',
  'ajoute UN bloc ```chart avec un JSON {schema_version: 1, title, source, option}.',
  'Regles : barres pour comparer des categories, line pour une evolution, pie pour des parts',
  '(6 parts max). Donnees LUES via tes outils uniquement, jamais inventees, 12 points max.',
  'source.static.rows = tes lignes lues ; option = option ECharts simple utilisant',
  'option.dataset (colonnes nommees comme dans la table), sans toolbox ni liens.',
  'Exemple : ```chart {"schema_version":1,"title":"Scores",',
  '"source":{"type":"static","rows":[{"nom":"Ada","score":95}]},',
  '"option":{"xAxis":{"type":"category"},"yAxis":{},"series":[{"type":"bar",',
  '"encode":{"x":"nom","y":"score"}}]}} ```',
].join('\n')

export function buildLunaSystemPrompt(pack: ContextePack, override?: string): string | undefined {
  const parts = [pack.system, CHART_SKILL, (override ?? '').trim()].filter((p) => p !== '')
  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}
