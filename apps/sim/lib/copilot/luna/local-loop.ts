/**
 * HyperFix chat-light : boucle Luna locale pour le chat workspace.
 *
 * Remplace l'orchestration Go (mothership) par une exécution 100% locale :
 * AgentBlockHandler + providers/registry (experiential/gpt-5.6-luna).
 * Les événements émis respectent les enveloppes mothership-stream-v1 que
 * l'UI consomme déjà — aucun changement frontend.
 *
 * Portée v1 : texte + thinking + outils (intégrations connectées, MCP,
 * fichiers, knowledge, tables), synchrone uniquement (pas de legs async).
 * Auth, permissions, persistance copilot, abort/stop, titres : inchangés
 * (chemins existants conservés).
 */

import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotMessages,
  credential,
  customTools,
  mcpServers,
  skill,
  workflow,
  workflowBlocks,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'
import {
  MothershipStreamV1CompletionStatus,
  type MothershipStreamV1StreamRef,
  type MothershipStreamV1Trace,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { loadContextePack } from '@/lib/copilot/luna/context-pack'
import {
  buildEnvelopes,
  buildLunaSystemPrompt,
  LUNA_MODEL,
  LUNA_WORKFLOW_NAME,
  translateAgentEvent,
} from '@/lib/copilot/luna/envelopes'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import type { StreamEvent } from '@/lib/copilot/request/session/contract'
import type {
  ExecutionContext as CopilotExecutionContext,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { getOperationOptionIds } from '@/lib/permission-groups/operation-access'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration/workflow-lifecycle'
import { getBlock } from '@/blocks/registry'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import type { Message as AgentMessage, ToolInput } from '@/executor/handlers/agent/types'
import type {
  ExecutionContext,
  ExecutorDelegationOrigin,
  StreamingExecution,
} from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('LunaLocalLoop')

const workflowIdCache = new Map<string, string>()

/** ID stable du bloc agent Luna (lu par l'autorisation MCP via ctx.mcpBlockId). */
export const LUNA_AGENT_BLOCK_ID = 'luna-chat'

/**
 * Persiste le bloc agent Luna (avec ses attachements MCP) dans le workflow.
 * Sans cette ligne, l'exécution d'outils MCP échoue en autorisation
 * ("MCP source block is missing or disabled"), car la provenance est relue
 * depuis les blocs persistés du workflow.
 */
export async function ensureLunaAgentBlock(
  workflowId: string,
  mcpEntries: ToolInput[]
): Promise<void> {
  await db
    .insert(workflowBlocks)
    .values({
      id: LUNA_AGENT_BLOCK_ID,
      workflowId,
      type: 'agent',
      name: 'Luna Chat',
      positionX: '0',
      positionY: '0',
      enabled: true,
      subBlocks: { tools: { value: mcpEntries } },
      outputs: {},
      data: {},
    })
    .onConflictDoUpdate({
      target: workflowBlocks.id,
      set: {
        subBlocks: { tools: { value: mcpEntries } },
        updatedAt: new Date(),
      },
    })
}

/** Vrai workflow provisionné par workspace (FK/logs/MCP-scoping restent cohérents). */
export async function ensureLunaWorkflowId(workspaceId: string, userId: string): Promise<string> {
  const cached = workflowIdCache.get(workspaceId)
  if (cached) return cached
  const [existing] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.name, LUNA_WORKFLOW_NAME),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)
  if (existing) {
    workflowIdCache.set(workspaceId, existing.id)
    return existing.id
  }
  const created = await performCreateWorkflowTransition({
    userId,
    workspaceId,
    name: LUNA_WORKFLOW_NAME,
    description: 'Chat Luna local (HyperFix chat-light) — ne pas supprimer.',
  })
  if (!created.success || !created.workflow) {
    throw new Error(`Echec provisionnement workflow Luna: ${created.error ?? 'inconnu'}`)
  }
  workflowIdCache.set(workspaceId, created.workflow.id)
  logger.info('Workflow Luna provisionné', { workspaceId, workflowId: created.workflow.id })
  return created.workflow.id
}

/** Services d'intégration connectés du workspace → entrées outils de l'agent. */
async function connectedServiceTypes(workspaceId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ providerId: credential.providerId })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        isNotNull(credential.providerId),
        isNull(credential.revokedAt)
      )
    )
  const types: string[] = []
  for (const row of rows) {
    const service = (row.providerId ?? '').trim().toLowerCase()
    if (service && BLOCK_REGISTRY[service] && !types.includes(service)) {
      types.push(service)
    }
  }
  return types
}

/** Skills du workspace → inputs skills (le handler injecte load_skill + section prompt). */
async function workspaceSkillInputs(workspaceId: string): Promise<{ skillId: string }[]> {
  try {
    const rows = await db
      .select({ id: skill.id })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .limit(30)
    return rows.map((r) => ({ skillId: r.id }))
  } catch (error) {
    logger.warn('Skills illisibles, ignorés', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/** Outils customs du workspace → entrées custom-tool (parité managée). */
async function workspaceCustomToolEntries(workspaceId: string): Promise<ToolInput[]> {
  try {
    const rows = await db
      .select({ id: customTools.id })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .limit(20)
    return rows.map(
      (r) => ({ type: 'custom-tool', customToolId: r.id, usageControl: 'auto' }) as ToolInput
    )
  } catch (error) {
    logger.warn('Outils customs illisibles, ignorés', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export interface LunaTurnInput {
  workspaceId: string
  userId: string
  principal?: SessionPrincipal
  executionId: string
  chatId?: string
  requestId: string
  /** Dernier message utilisateur (texte brut). */
  message: string
  systemPrompt?: string
  /** Origine de délégation (chemin chat normal la fournit ; défaut sujet direct). */
  executorDelegationOrigin?: ExecutorDelegationOrigin
  /** Registry de traçabilité des secrets (obligatoire : sans lui les outils échouent). */
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  /** Facturation (exigée par les outils MCP ; résolue comme la prod sinon). */
  billingAttribution?: BillingAttributionSnapshot
  abortSignal?: AbortSignal
  onEvent: (event: StreamEvent) => void | Promise<void>
}

export interface LunaTurnResult {
  status: 'complete' | 'error' | 'cancelled'
  text: string
}

async function drainAgentStream(
  streaming: StreamingExecution,
  emit: (event: AgentStreamEvent) => void | Promise<void>,
  abortSignal?: AbortSignal
): Promise<string> {
  let fullText = ''
  let pendingText = ''
  // Pas de `streaming.subscribe` : l'abonnement installé ici arriverait après
  // le drain de la pompe (abonnés tardifs = événements futurs uniquement).
  // La boucle ci-dessous transmet chaque événement lu (le traducteur filtre
  // les frontières internes type turn_end) : chemin unique et déterministe.
  if (streaming.streamFormat !== 'agent-events-v1') {
    const byteReader = (streaming.stream as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    for (;;) {
      if (abortSignal?.aborted) break
      const { done, value } = await byteReader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      fullText += chunk
      await emit({ type: 'text_delta', text: chunk, turn: 'final' })
    }
    try {
      byteReader.releaseLock()
    } catch {
      // déjà libéré par le pump interne
    }
    return fullText
  }
  const reader = (streaming.stream as ReadableStream<AgentStreamEvent>).getReader()
  for (;;) {
    if (abortSignal?.aborted) break
    const { done, value } = await reader.read()
    if (done) break
    if (value.type === 'text_delta') {
      if (value.turn === 'intermediate') continue
      if (value.turn === 'pending') {
        pendingText += value.text
        await emit(value)
        continue
      }
      fullText += value.text
      await emit(value)
    } else if (value.type === 'turn_end') {
      if (value.turn === 'final') {
        fullText += pendingText
      }
      pendingText = ''
    } else {
      await emit(value)
    }
  }
  try {
    reader.releaseLock()
  } catch {
    // déjà libéré par le pump interne
  }
  return fullText
}

/** Historique du chat (sans les balises système Go type <usage_*>) → transcript agent. */
async function loadTranscript(chatId: string, limit = 30): Promise<AgentMessage[]> {
  const rows = await db
    .select({ role: copilotMessages.role, content: copilotMessages.content })
    .from(copilotMessages)
    .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
    .orderBy(asc(copilotMessages.createdAt))
    .limit(limit)
  const out: AgentMessage[] = []
  for (const row of rows) {
    const role = row.role === 'assistant' ? 'assistant' : ('user' as const)
    const raw = (row.content as { content?: unknown })?.content
    if (typeof raw !== 'string') continue
    const text = raw.replace(/<usage_[\s\S]*?<\/usage_[\s\S]*?>/g, '').trim()
    if (!text) continue
    out.push({ role, content: text })
  }
  return out.slice(-limit)
}

/**
 * Entrées d'outils `{type, operation}` par bloc : TOUTES les opérations
 * (lecture + écriture), parité avec le chemin managé sim.ai — Luna exécute
 * sans UI d'approbation (usage solo assumé).
 * Les blocs sans menu d'opération (ex. file → file_read par défaut) sont
 * ajoutés nus : le sélecteur d'outil retombe sur `access[0]`.
 */
function workspaceToolEntries(blockTypes: string[]): ToolInput[] {
  const entries: ToolInput[] = []
  for (const type of blockTypes) {
    let block
    try {
      block = getBlock(type)
    } catch {
      continue
    }
    if (!block) continue
    const operations = getOperationOptionIds(block)
    if (operations.length === 0) {
      entries.push({ type, usageControl: 'auto' } as ToolInput)
      continue
    }
    for (const operation of operations) {
      entries.push({ type, operation, usageControl: 'auto' } as ToolInput)
      if (entries.length >= 60) return entries
    }
  }
  return entries
}

/** Inventaire minimal d'une table Sim pour liaison d'outils + prompt. */
export interface LunaTableInventory {
  id: string
  name: string
  rowCount: number
}

/**
 * Tables du workspace (lecture directe, session déjà autorisée).
 * Sert à lier les outils table (`tableId` est `user-only` : le modèle ne peut
 * pas le fournir, il doit être pré-rempli comme le fait le picker).
 */
export async function listLunaTables(workspaceId: string): Promise<LunaTableInventory[]> {
  try {
    const { listTables } = await import('@/lib/table')
    const tables = await listTables(workspaceId, {})
    return tables.slice(0, 10).map((t) => ({ id: t.id, name: t.name, rowCount: t.rowCount }))
  } catch (error) {
    logger.warn('Tables du workspace illisibles, outils table ignorés', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * Entrées liées par table : TOUTES les ops (lecture + écriture, parité
 * managée). `tableId` pré-rempli côté serveur (`user-only`).
 */
const TABLE_OPERATIONS = [
  'query_rows',
  'get_schema',
  'get_row',
  'insert_row',
  'batch_insert_rows',
  'upsert_row',
  'update_row',
  'update_rows_by_filter',
  'delete_row',
  'delete_rows_by_filter',
]

function boundTableEntries(tables: LunaTableInventory[]): ToolInput[] {
  const entries: ToolInput[] = []
  for (const table of tables) {
    for (const operation of TABLE_OPERATIONS) {
      entries.push({
        type: 'table',
        operation,
        params: { tableId: table.id },
        title: `Table ${table.name}`,
        usageControl: 'auto',
      } as ToolInput)
      if (entries.length >= 60) return entries
    }
  }
  return entries
}

/** Ligne d'inventaire injectée au prompt système pour nommer les tables. */
export function tableInventoryPrompt(tables: LunaTableInventory[]): string {
  if (tables.length === 0) return ''
  const lines = tables.map((t) => `- ${t.name} (${t.rowCount} lignes)`)
  return `Tables du workspace (lis, crée, remplis, modifie, supprime via tes outils table) :\n${lines.join('\n')}`
}

export async function runLocalLunaTurn(input: LunaTurnInput): Promise<LunaTurnResult> {
  const {
    workspaceId,
    userId,
    principal,
    executionId,
    chatId,
    requestId,
    message,
    systemPrompt,
    executorDelegationOrigin,
    resolvedSecretTraceRegistry,
    billingAttribution,
    abortSignal,
    onEvent,
  } = input

  const lunaWorkflowId = await ensureLunaWorkflowId(workspaceId, userId)
  const streamRef: MothershipStreamV1StreamRef = {
    streamId: executionId,
    ...(chatId ? { chatId } : {}),
  }
  const trace: MothershipStreamV1Trace = { requestId }
  const env = buildEnvelopes(streamRef, trace)

  await onEvent({
    type: 'session',
    payload: { kind: 'start' },
    seq: 0,
    stream: streamRef,
    trace,
    ts: new Date().toISOString(),
    v: 1,
  } as StreamEvent)

  const services = await connectedServiceTypes(workspaceId).catch((error) => {
    logger.warn('Services connectés illisibles, outils réduits', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return [] as string[]
  })

  // Serveurs MCP activés du workspace (entrée avancée = tous leurs outils).
  // Filtrés par résolvabilité DNS : un serveur injoignable ferait échouer
  // tout le tour en découverte (erreur fatale), on le saute avec un warn.
  let mcpServerIds: string[] = []
  try {
    const rows = await db
      .select({ id: mcpServers.id, url: mcpServers.url })
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.enabled, true)))
    const { lookup } = await import('node:dns/promises')
    const checks = await Promise.all(
      rows.map(async (row) => {
        try {
          const hostname = new URL(row.url ?? '').hostname
          if (!hostname) return null
          await lookup(hostname)
          return row.id
        } catch {
          logger.warn('Serveur MCP injoignable, ignoré pour ce tour', {
            workspaceId,
            serverId: row.id,
          })
          return null
        }
      })
    )
    mcpServerIds = checks.filter((id): id is string => id !== null)
  } catch (error) {
    logger.warn('Serveurs MCP illisibles, ignorés', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const tools: ToolInput[] = [
    // file_v5 = gestionnaire complet (le type 'file' legacy ne fait que parser).
    ...workspaceToolEntries([...services, 'file_v5', 'knowledge']),
    // Création de table : globale (pas de tableId requis).
    { type: 'table', operation: 'create', usageControl: 'auto' } as ToolInput,
    ...boundTableEntries(await listLunaTables(workspaceId)),
    ...mcpServerIds.map(
      (serverId) =>
        ({
          type: 'mcp-server-advanced',
          params: { serverId },
        }) as ToolInput
    ),
    // Outils customs du workspace (parité managée).
    ...(await workspaceCustomToolEntries(workspaceId)),
  ]
  // Skills du workspace (le handler injecte load_skill + section prompt).
  const skillInputs = await workspaceSkillInputs(workspaceId)
  logger.info('Outils Luna assemblés', {
    workspaceId,
    services,
    mcpServers: mcpServerIds.length,
    skills: skillInputs.length,
    toolEntries: tools.length,
  })

  const block: SerializedBlock = {
    // ID STABLE (pas par exécution) : le handler pose ctx.mcpBlockId = block.id
    // et l'autorisation MCP relit ce bloc dans le workflow. Voir ensureLunaAgentBlock.
    id: 'luna-chat',
    position: { x: 0, y: 0 },
    config: { tool: BlockType.AGENT, params: { model: LUNA_MODEL } },
    inputs: {},
    outputs: {},
    metadata: { id: BlockType.AGENT, name: 'Luna Chat' },
    enabled: true,
  }
  const blockId = block.id as string

  // Persiste le bloc agent (avec ses attachements MCP) dans le workflow Luna :
  // sans lui, l'autorisation d'exécution MCP échoue ("source block missing").
  await ensureLunaAgentBlock(
    lunaWorkflowId,
    tools.filter((tool) => tool.type === 'mcp-server-advanced')
  ).catch((error) => {
    logger.warn('Bloc agent Luna non persisté, outils MCP réduits', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  const execContext: ExecutionContext = {
    workflowId: lunaWorkflowId,
    workspaceId,
    executionId,
    userId,
    ...(principal ? { principal } : {}),
    // Streaming exigé par le handler (sinon provider en stream:false et
    // réponse d'un seul bloc) : stream + output sélectionné = bloc courant.
    stream: true,
    selectedOutputs: [blockId],
    // Autorité d'exécution exigée par l'enrichissement des schémas d'outils
    // (tables, KB) : même défaut que le chemin Go (sujet direct). Sans
    // executionId : il pointerait vers un run inexistant (pas de ligne
    // d'exécution en boucle locale) et la délégation serait rejetée.
    executorDelegationOrigin: executorDelegationOrigin ?? {
      subjectUserId: userId,
      workflowId: lunaWorkflowId,
    },
    // Traçabilité des secrets exigée par l'exécution des outils : sans
    // registry, le garde-fou providers/runtime-context fait échouer chaque
    // appel silencieusement (success:false sans message).
    ...(resolvedSecretTraceRegistry ? { resolvedSecretTraceRegistry } : {}),
    copilotToolExecution: true,
    blockStates: new Map(),
    executedBlocks: new Set<string>(),
    blockLogs: [],
    metadata: {
      duration: 0,
      // Facturation exigée par les outils MCP (chemin Go identique).
      ...(billingAttribution ? { billingAttribution } : {}),
    },
    environmentVariables: {},
    decisions: { router: new Map<string, string>(), condition: new Map<string, string>() },
    completedLoops: new Set<string>(),
    activeExecutionPath: new Set<string>(),
  }

  const messages: AgentMessage[] = chatId ? await loadTranscript(chatId) : []
  messages.push({ role: 'user', content: message })
  const agentInputs = {
    model: LUNA_MODEL,
    messages,
    tools,
    ...(skillInputs.length > 0 ? { skills: skillInputs } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    memoryType: 'none' as const,
  }

  const handler = new AgentBlockHandler()
  let result: StreamingExecution | BlockOutput
  try {
    result = await handler.execute(execContext, block, agentInputs)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Echec execution Luna locale', { workspaceId, executionId, error: msg })
    await onEvent(env.complete('error'))
    return { status: 'error', text: '' }
  }
  // Les exécutions d'outils sont internes à la boucle agent (aucun événement
  // tool sur le stream v1) : la preuve fonctionnelle vit dans les smoke tests.

  const streaming: StreamingExecution | null =
    typeof result === 'object' &&
    result !== null &&
    'stream' in result &&
    (result as StreamingExecution).stream
      ? (result as StreamingExecution)
      : null
  if (!streaming) {
    const content = (result as unknown as { content?: unknown }).content
    const text = typeof content === 'string' ? content : ''
    if (text) await onEvent(env.text('assistant', text))
    await onEvent(env.complete('complete'))
    return { status: 'complete', text }
  }

  let fullText = ''
  try {
    fullText = await drainAgentStream(
      streaming,
      async (event) => {
        const translated = translateAgentEvent(env, event)
        if (translated) await onEvent(translated)
      },
      abortSignal
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Echec drain stream Luna', { workspaceId, executionId, error: msg })
    await onEvent(env.complete('error'))
    return { status: 'error', text: fullText }
  }

  if (abortSignal?.aborted) {
    await onEvent(env.complete('cancelled'))
    return { status: 'cancelled', text: fullText }
  }
  await onEvent(env.complete('complete'))
  return { status: 'complete', text: fullText }
}

/**
 * Entrée appelée par runCheckpointLoop pour un tour workspace : exécute Luna
 * en local puis renseigne le contexte comme un leg Go terminé (texte accumulé,
 * statut complete, erreurs éventuelles). Pas de continuation async (synchrone).
 */
export async function runWorkspaceLunaTurn(args: {
  payload: Record<string, unknown>
  context: StreamingContext
  execContext: CopilotExecutionContext
  options: CopilotLifecycleOptions
}): Promise<void> {
  const { payload, context, options } = args
  const workspaceId = options.workspaceId ?? ''
  const userId = options.userId
  const message =
    typeof payload.message === 'string' && payload.message.trim() !== ''
      ? payload.message
      : "Bonjour ! Que puis-je faire pour vous aujourd'hui ?"
  const systemPromptOverride =
    typeof payload.systemPromptOverride === 'string' && payload.systemPromptOverride.trim() !== ''
      ? payload.systemPromptOverride
      : undefined
  // Pack contexte déclaratif (convention contexte/) + override éventuel.
  const pack = await loadContextePack(workspaceId, userId).catch(() => ({
    present: false as const,
    system: '',
    truncated: false,
  }))
  const inventory = tableInventoryPrompt(await listLunaTables(workspaceId))
  const finalSystemPrompt = [buildLunaSystemPrompt(pack, systemPromptOverride), inventory]
    .filter((p) => p && p.trim() !== '')
    .join('\n\n')

  // Même source que le chemin chat normal (run.ts ensureModelEgressRegistry).
  const resolvedSecretTraceRegistry =
    options.resolvedSecretTraceRegistry ??
    options.environmentContext?.resolvedSecretTraceRegistry ??
    (await prepareCopilotEnvironmentContext(userId, workspaceId)).resolvedSecretTraceRegistry

  // Facturation exigée par les outils MCP : celle de la requête si présente,
  // sinon résolue comme la prod (même payeur que le chemin normal).
  let billingAttribution = options.billingAttribution
  if (!billingAttribution && workspaceId) {
    try {
      const { resolveBillingAttribution } = await import('@/lib/billing/core/billing-attribution')
      billingAttribution = await resolveBillingAttribution({ actorUserId: userId, workspaceId })
    } catch (error) {
      logger.warn('Facturation illisible, outils MCP indisponibles ce tour-ci', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const result = await runLocalLunaTurn({
    workspaceId,
    userId,
    executionId: options.executionId ?? options.runId ?? `luna-${Date.now()}`,
    chatId: options.chatId,
    requestId: options.simRequestId ?? context.requestId ?? 'luna',
    message,
    ...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
    resolvedSecretTraceRegistry,
    ...(billingAttribution ? { billingAttribution } : {}),
    ...(options.executorDelegationOrigin
      ? { executorDelegationOrigin: options.executorDelegationOrigin }
      : {}),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    onEvent: async (event) => {
      await options.onEvent?.(event)
    },
  })

  context.accumulatedContent += result.text
  context.finalAssistantContent += result.text
  if (result.status === 'complete') {
    context.completionStatus = MothershipStreamV1CompletionStatus.complete
  } else if (result.status === 'cancelled') {
    context.wasAborted = true
  } else {
    context.errors.push('Echec execution Luna locale')
  }
  context.streamComplete = true
}
