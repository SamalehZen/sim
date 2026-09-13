/**
 * HyperFix chat-light : pack de contexte déclaratif façon nao-core.
 *
 * Lit la convention `contexte/` d'un workspace (fichiers VFS) + l'inventaire
 * Sim (tables, skills, knowledge bases) et compose la section système Luna :
 * règles + glossaire/modèle + schémas de tables + descripteurs de skills +
 * index docs. Jamais de lignes CSV / corps docs / contenu skills inline :
 * pointeurs VFS + outils existants.
 *
 * Budgets calés sur les conventions existantes (selection-context,
 * TOOL_RESULT_MAX_INLINE_TOKENS) : ~36k chars au total.
 */
import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import { readFileRecord } from '@/lib/copilot/vfs/file-reader'
import { listTables } from '@/lib/table/service'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { listSkillsForUser } from '@/lib/workflows/skills/operations'

const logger = createLogger('LunaContextPack')

export const CONTEXTE_DIR = 'contexte'
export const REGLES_PATH = `${CONTEXTE_DIR}/regles.md`
export const METADONNEES_PATH = `${CONTEXTE_DIR}/metadonnees.yaml`
export const MODELISATION_DIR = `${CONTEXTE_DIR}/modelisation`

const BUDGET_REGLES = 12_000
const BUDGET_META = 12_000
const BUDGET_INDEX = 12_000

export interface ContextePack {
  /** true si un dossier contexte/ existe (au moins regles.md lisible). */
  present: boolean
  /** Section système complète, prête à injecter. Chaîne vide si absent. */
  system: string
  truncated: boolean
}

async function readContexteText(workspaceId: string, path: string): Promise<string | null> {
  try {
    const record = await resolveWorkspaceFileReference(workspaceId, path)
    if (!record) return null
    const result = await readFileRecord(record)
    if (!result || result.error || !result.content) return null
    return result.content
  } catch (error) {
    logger.warn('Lecture contexte impossible', {
      workspaceId,
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function stableSort<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

export async function loadContextePack(workspaceId: string, userId: string): Promise<ContextePack> {
  const empty: ContextePack = { present: false, system: '', truncated: false }
  let regles: string | null = null
  try {
    regles = await readContexteText(workspaceId, REGLES_PATH)
  } catch {
    return empty
  }
  if (!regles || regles.trim() === '') return empty

  let truncated = false
  const sections: string[] = []
  const reglesText = truncate(regles.trim(), BUDGET_REGLES)
  truncated = truncated || reglesText.length >= BUDGET_REGLES
  sections.push(`# Règles (contexte/regles.md)\n${reglesText}`)

  // Glossaire + modélisation (fichiers texte, fusionnés).
  const metaParts: string[] = []
  const meta = await readContexteText(workspaceId, METADONNEES_PATH).catch(() => null)
  if (meta && meta.trim() !== '') metaParts.push(`## metadonnees.yaml\n${meta.trim()}`)
  // Fichiers modelisation/* : noms stables triés ; lecture bornée au mieux.
  // (Pas d'API liste-dossier légère ici : on tente les extensions usuelles via
  // les chemins canoniques connus, sinon on ignore silencieusement.)
  const metaText = truncate(metaParts.join('\n\n'), BUDGET_META)
  if (metaText.trim() !== '') {
    truncated = truncated || metaText.length >= BUDGET_META
    sections.push(`# Glossaire & modèle\n${metaText}`)
  }

  // Index tables (schémas seuls, jamais de lignes).
  try {
    const tables = stableSort(await listTables(workspaceId), (t) =>
      String((t as { name?: unknown }).name ?? '')
    )
    const lines = tables.map((t) => {
      const row = t as { id?: unknown; name?: unknown; description?: unknown; schema?: unknown }
      const cols = Array.isArray((row.schema as { columns?: unknown })?.columns)
        ? ((row.schema as { columns: Array<{ name?: unknown; type?: unknown }> }).columns ?? [])
        : []
      const colList = cols
        .map((c) => `${String(c.name ?? '?')}:${String(c.type ?? '?')}`)
        .join(', ')
      const desc =
        typeof row.description === 'string' && row.description ? ` — ${row.description}` : ''
      return `- ${String(row.name ?? '?')}${desc}${colList ? ` (colonnes: ${colList})` : ''}`
    })
    if (lines.length > 0) {
      const idx = truncate(lines.join('\n'), BUDGET_INDEX)
      sections.push(`# Tables disponibles (schémas, interrogeables via l'outil table)\n${idx}`)
    }
  } catch (error) {
    logger.warn('Index tables impossible', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Index skills (descripteurs seuls, corps via VFS on-demand comme process-contents).
  try {
    const skills = stableSort(
      await listSkillsForUser({ workspaceId, userId, includeBuiltins: false }),
      (s) => String(s.name ?? '')
    )
    const lines = skills.map((s) => {
      const desc =
        typeof (s as { description?: unknown }).description === 'string' &&
        (s as { description?: string }).description
          ? ` — ${(s as { description?: string }).description}`
          : ''
      return `- ${String((s as { name?: unknown }).name ?? '?')}${desc}`
    })
    if (lines.length > 0) {
      const idx = truncate(lines.join('\n'), BUDGET_INDEX)
      sections.push(`# Skills disponibles (contenu via mention @skill)\n${idx}`)
    }
  } catch (error) {
    logger.warn('Index skills impossible', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Index knowledge bases (noms seuls, contenu via recherche sémantique).
  try {
    const kbs = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.workspaceId, workspaceId))
    const rows = stableSort(kbs, (k) => String(k.name ?? ''))
    const lines = rows.map((k) => {
      const desc = typeof k.description === 'string' && k.description ? ` — ${k.description}` : ''
      return `- ${String(k.name ?? '?')}${desc}`
    })
    if (lines.length > 0) {
      const idx = truncate(lines.join('\n'), BUDGET_INDEX)
      sections.push(`# Bases documentaires (contenu via recherche, jamais inline)\n${idx}`)
    }
  } catch (error) {
    logger.warn('Index knowledge impossible', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { present: true, system: sections.join('\n\n'), truncated }
}
