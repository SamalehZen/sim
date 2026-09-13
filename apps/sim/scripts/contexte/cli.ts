#!/usr/bin/env bun
/**
 * HyperFix chat-light : CLI du dossier-contexte déclaratif (façon nao-core).
 *
 *   bun apps/sim/scripts/contexte/cli.ts init [--dir <chemin>]
 *   bun apps/sim/scripts/contexte/cli.ts valide [--dir <chemin>] [--workspace <id>]
 *   bun apps/sim/scripts/contexte/cli.ts sync [--dir <chemin>] --workspace <id> --user <id> [--dry-run]
 *   bun apps/sim/scripts/contexte/cli.ts teste [--workspace <id>]
 *
 * Convention :
 *   contexte/regles.md, contexte/metadonnees.yaml, contexte/modelisation/*,
 *   contexte/docs/*, contexte/competences/*.md, contexte/donnees/*.{csv,json,xlsx},
 *   contexte/outils.yaml, contexte/llm.yaml
 *
 * DATABASE_URL requis pour valide (collisions), sync et teste.
 * Exécution prod : via le conteneur (accès disque storage + DB) :
 *   docker exec -w /app/apps/sim sim_light bun scripts/contexte/cli.ts sync ...
 *
 * NOTE docs/ : l'ingestion knowledge base (parse/chunk/embeddings) passe par
 * l'UI ; la CLI couvre tables, skills et fichiers. MCP : dry-run uniquement.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseCsv } from 'csv-parse/sync'
import yaml from 'js-yaml'

const LUNA_MODEL = 'experiential/gpt-5.6-luna'

function usage(): never {
  process.stderr.write(
    'Usage:\n' +
      '  bun apps/sim/scripts/contexte/cli.ts init [--dir <chemin>]\n' +
      '  bun apps/sim/scripts/contexte/cli.ts valide [--dir <chemin>] [--workspace <id>]\n' +
      '  bun apps/sim/scripts/contexte/cli.ts sync [--dir <chemin>] --workspace <id> --user <id> [--dry-run]\n' +
      '  bun apps/sim/scripts/contexte/cli.ts teste [--workspace <id>]\n'
  )
  process.exit(1)
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function has(name: string): boolean {
  return process.argv.includes(name)
}

const TEMPLATES: Record<string, string> = {
  'regles.md':
    '# Règles\n\nDécrivez ici le métier : vocabulaire, seuils, processus.\nRestez concis : ce fichier est injecté dans chaque tour Luna.\n',
  'metadonnees.yaml':
    'version: 1\ndataset: exemple\n' +
    'description: Description courte du périmètre.\n' +
    'glossaire:\n  - {colonne: code, label: Code article, type: string}\n' +
    'relations: []\nmesures: []\nseuils: []\n',
  'modelisation/exemple.yaml': 'glossaire: []\nrelations: []\nmesures: []\nseuils: []\n',
  'llm.yaml': `model: ${LUNA_MODEL}\ntemperature: 0.1\nrepli: deepseek-v4-flash\n`,
  'outils.yaml': '# Serveurs MCP (dry-run par défaut, SSRF-safe)\nmcp: []\n',
  'docs/README.md': '# Docs\n\nDéposez ici les .md (sinon importés en knowledge base via l’UI).\n',
  'competences/exemple.md': '# Exemple\n\nDécrivez une procédure que Luna doit savoir exécuter.\n',
  'donnees/README.md': '# Données\n\nCSV (recommandé), JSON ou XLSX. Première ligne = en-têtes.\n',
}

async function cmdInit(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(TEMPLATES)) {
    const parts = rel.split('/')
    if (parts.length > 1) mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true })
    const full = join(dir, rel)
    if (!existsSync(full)) {
      writeFileSync(full, content)
      console.log(`+ ${rel}`)
    } else {
      console.log(`= ${rel} (existe déjà)`)
    }
  }
  console.log(`Contexte initialisé dans ${dir}`)
}

async function cmdValide(dir: string, workspaceId?: string): Promise<boolean> {
  const errors: string[] = []
  for (const f of ['regles.md', 'metadonnees.yaml', 'llm.yaml', 'outils.yaml']) {
    if (!existsSync(join(dir, f))) errors.push(`manquant: ${f}`)
  }
  for (const f of ['metadonnees.yaml', 'llm.yaml', 'outils.yaml']) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try {
      const value: unknown = yaml.load(readFileSync(p, 'utf8'))
      if (f === 'llm.yaml' && (value as { model?: unknown })?.model !== LUNA_MODEL) {
        errors.push(`llm.yaml: model doit être ${LUNA_MODEL}`)
      }
    } catch (e) {
      errors.push(`YAML invalide ${f}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const compDir = join(dir, 'competences')
  if (existsSync(compDir)) {
    for (const f of readdirSync(compDir)) {
      if (!f.endsWith('.md')) errors.push(`competences/${f} : extension .md requise`)
    }
  }
  const donneesDir = join(dir, 'donnees')
  if (existsSync(donneesDir)) {
    for (const f of readdirSync(donneesDir)) {
      if (f === 'README.md') continue
      if (!/\.(csv|json|xlsx|xls)$/i.test(f))
        errors.push(`donnees/${f} : format csv/json/xlsx requis`)
      else if (statSync(join(donneesDir, f)).size === 0) errors.push(`donnees/${f} : vide`)
    }
  }
  if (workspaceId) {
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL requis pour les collisions workspace')
    } else {
      const { listTables } = await import('@/lib/table/service')
      const names = new Set(
        ((await listTables(workspaceId).catch(() => [])) as Array<{ name?: unknown }>).map((t) =>
          String(t.name ?? '').toLowerCase()
        )
      )
      if (existsSync(donneesDir)) {
        for (const f of readdirSync(donneesDir)) {
          const base = f.replace(/\.(csv|json|xlsx|xls)$/i, '').toLowerCase()
          if (base && base !== 'readme' && names.has(base)) {
            console.log(`! table existante (conservée) : ${f}`)
          }
        }
      }
    }
  }
  if (errors.length > 0) {
    console.log('VALIDE: ÉCHEC')
    for (const e of errors) console.log(`  - ${e}`)
    return false
  }
  console.log('VALIDE: OK')
  return true
}

function inferType(values: string[]): 'number' | 'boolean' | 'string' {
  const vals = values.filter((v) => v !== '' && v != null)
  if (vals.length === 0) return 'string'
  if (vals.every((v) => /^(true|false|oui|non|0|1)$/i.test(v.trim()))) return 'boolean'
  if (vals.every((v) => !Number.isNaN(Number(v.replace(',', '.'))))) return 'number'
  return 'string'
}

function readDataset(file: string): { headers: string[]; rows: Record<string, string>[] } {
  if (/\.json$/i.test(file)) {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const arr = Array.isArray(data) ? data : []
    const headers = Array.from(
      new Set(arr.flatMap((r) => (typeof r === 'object' && r !== null ? Object.keys(r) : [])))
    )
    return { headers, rows: arr as Record<string, string>[] }
  }
  if (/\.xlsx?$/i.test(file)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.readFile(file)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[][]
    const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean)
    const rows = aoa
      .slice(1)
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '')])))
    return { headers, rows }
  }
  const recs = parseCsv(readFileSync(file, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[]
  return { headers: recs.length > 0 ? Object.keys(recs[0]) : [], rows: recs }
}

async function lazyDb() {
  const [{ db }, drizzle, schema, idmod] = await Promise.all([
    import('../../../../packages/db/db.js'),
    import('drizzle-orm'),
    import('@sim/db/schema'),
    import('@sim/utils/id'),
  ])
  return { db, ...drizzle, schema, generateId: idmod.generateId as () => string }
}

async function ensureFolder(workspaceId: string, userId: string, name: string): Promise<string> {
  const { db, eq, and, schema, generateId } = await lazyDb()
  const [row] = await db
    .select({ id: schema.folder.id })
    .from(schema.folder)
    .where(
      and(
        eq(schema.folder.workspaceId, workspaceId),
        eq(schema.folder.name, name),
        eq(schema.folder.resourceType, 'file')
      )
    )
    .limit(1)
  if (row) return row.id
  const id = generateId()
  await db.insert(schema.folder).values({ id, resourceType: 'file', name, userId, workspaceId })
  return id
}

async function syncFile(
  workspaceId: string,
  userId: string,
  rel: string,
  buf: Buffer,
  contentType: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] fichier ${rel} (${buf.length} o)`)
    return
  }
  const base = rel.split('/').pop() as string
  const key = `workspace/${workspaceId}/${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${base}`
  const { uploadFile } = await import('@/lib/uploads/core/storage-service')
  await uploadFile({
    file: buf,
    fileName: base,
    contentType,
    context: 'workspace',
    preserveKey: true,
    customKey: key,
    persistMetadata: false,
  })
  const folderId = await ensureFolder(workspaceId, userId, 'contexte')
  const { db, schema, generateId } = await lazyDb()
  await db.insert(schema.workspaceFiles).values({
    id: generateId(),
    key,
    userId,
    workspaceId,
    context: 'workspace',
    originalName: base,
    displayName: base,
    contentType,
    size: buf.length,
    folderId,
  })
  console.log(`[sync] fichier ${rel} (${buf.length} o)`)
}

async function cmdSync(
  dir: string,
  workspaceId: string,
  userId: string,
  dryRun: boolean
): Promise<void> {
  await syncFile(
    workspaceId,
    userId,
    'regles.md',
    readFileSync(join(dir, 'regles.md')),
    'text/markdown',
    dryRun
  )
  await syncFile(
    workspaceId,
    userId,
    'metadonnees.yaml',
    readFileSync(join(dir, 'metadonnees.yaml')),
    'text/yaml',
    dryRun
  )
  const modelDir = join(dir, 'modelisation')
  if (existsSync(modelDir)) {
    for (const f of readdirSync(modelDir)) {
      if (!/\.(yaml|yml|md)$/.test(f)) continue
      await syncFile(
        workspaceId,
        userId,
        `modelisation/${f}`,
        readFileSync(join(modelDir, f)),
        f.endsWith('.md') ? 'text/markdown' : 'text/yaml',
        dryRun
      )
    }
  }

  const compDir = join(dir, 'competences')
  if (existsSync(compDir)) {
    const { upsertSkills } = await import('@/lib/workflows/skills/operations')
    for (const f of readdirSync(compDir)) {
      if (!f.endsWith('.md')) continue
      const content = readFileSync(join(compDir, f), 'utf8')
      const name = f.replace(/\.md$/, '')
      const description =
        content
          .split('\n')
          .find((l) => l.trim() !== '' && !l.startsWith('#'))
          ?.trim() ?? name
      if (dryRun) {
        console.log(`[dry-run] skill ${name}`)
        continue
      }
      await upsertSkills({ skills: [{ name, description, content }], workspaceId, userId })
      console.log(`[sync] skill ${name}`)
    }
  }

  const donneesDir = join(dir, 'donnees')
  if (existsSync(donneesDir)) {
    for (const f of readdirSync(donneesDir)) {
      if (!/\.(csv|json|xlsx|xls)$/i.test(f)) continue
      const { headers, rows } = readDataset(join(donneesDir, f))
      if (headers.length === 0) {
        console.log(`[sync] ${f} : vide, ignoré`)
        continue
      }
      const name = f.replace(/\.(csv|json|xlsx|xls)$/i, '')
      if (dryRun) {
        console.log(`[dry-run] table ${name} (${rows.length} lignes, ${headers.length} cols)`)
        continue
      }
      const { listTables, createTable } = await import('@/lib/table/service')
      const existing = (
        (await listTables(workspaceId).catch(() => [])) as Array<{ id?: unknown; name?: unknown }>
      ).find((t) => String(t.name ?? '').toLowerCase() === name.toLowerCase())
      if (existing?.id) {
        console.log(`[sync] table existante ${name} (lignes conservées)`)
        continue
      }
      const { generateColumnId } = await import('@/lib/table/column-keys')
      const { userTableRows } = await import('@sim/db/schema')
      const { db, generateId } = await lazyDb()
      const created = (await createTable(
        {
          name,
          description: `Import contexte ${f}`,
          schema: {
            columns: headers.map((h) => ({
              id: generateColumnId(),
              name: h,
              type: inferType(rows.map((r) => r[h] ?? '')),
            })),
          },
          workspaceId,
          userId,
        },
        `contexte-sync-${Date.now()}`
      )) as { id?: unknown }
      const tableId = String(created.id ?? '')
      await db
        .insert(userTableRows)
        .values(
          rows.map((r, i) => ({ id: generateId(), tableId, workspaceId, data: r, position: i }))
        )
      console.log(`[sync] table ${name} créée (${rows.length} lignes)`)
    }
  }

  const outilsPath = join(dir, 'outils.yaml')
  if (existsSync(outilsPath)) {
    const doc = yaml.load(readFileSync(outilsPath, 'utf8')) as {
      mcp?: Array<{ url?: unknown }>
    } | null
    for (const s of doc?.mcp ?? []) {
      const url = typeof s?.url === 'string' ? s.url : ''
      let ok = false
      try {
        const u = new URL(url)
        ok = u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        ok = false
      }
      console.log(
        `[sync] MCP ${url || '(sans url)'} : ${ok ? 'URL valide (dry-run, création manuelle via UI)' : 'URL INVALIDE, ignoré'}`
      )
    }
  }
  console.log(dryRun ? 'SYNC dry-run terminé' : 'SYNC terminé')
}

async function cmdTeste(workspaceId?: string): Promise<void> {
  const { buildLunaSystemPrompt } = await import('@/lib/copilot/luna/envelopes')
  const out = buildLunaSystemPrompt(
    { present: false, system: 'exemple', truncated: false },
    'override'
  )
  if (!out || out.length > 40_000) {
    console.log('TESTE: ÉCHEC budget prompt')
    process.exit(1)
  }
  if (workspaceId) {
    if (!process.env.DATABASE_URL) {
      console.log('TESTE: DATABASE_URL requis pour le pack live')
      process.exit(1)
    }
    const { loadContextePack } = await import('@/lib/copilot/luna/context-pack')
    const live = await loadContextePack(workspaceId, 'test')
    console.log(`TESTE: pack live present=${live.present} system=${live.system.length} chars`)
  }
  console.log('TESTE: OK')
}

async function main(): Promise<void> {
  const [cmd] = process.argv.slice(2)
  const dir = flag('--dir') ?? join(process.cwd(), 'contexte')
  if (cmd === 'init') {
    await cmdInit(dir)
  } else if (cmd === 'valide') {
    const ok = await cmdValide(dir, flag('--workspace'))
    if (!ok) process.exit(1)
  } else if (cmd === 'sync') {
    const workspaceId = flag('--workspace')
    const userId = flag('--user')
    if (!workspaceId || !userId) usage()
    if (!process.env.DATABASE_URL) {
      console.log('DATABASE_URL requis pour sync')
      process.exit(1)
    }
    const ok = await cmdValide(dir, workspaceId)
    if (!ok) process.exit(1)
    await cmdSync(dir, workspaceId, userId, has('--dry-run'))
  } else if (cmd === 'teste') {
    await cmdTeste(flag('--workspace'))
  } else {
    usage()
  }
}

main().catch((e) => {
  console.error('CLI contexte:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
