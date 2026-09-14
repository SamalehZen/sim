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
 * HyperFix chat-light (Phase B2) : skill visuels au format nao. Luna émet un
 * fence ```chart contenant un JSON display_chart (contrat lib/charts/nao) :
 * source (table Sim lue en live ou lignes statiques déjà lues via les outils
 * table), chart_type, x_axis_key, series. Rendu recharts côté UI, comme nao.
 */
const CHART_SKILL = [
  'Graphiques : quand des nombres se comparent mieux en image, ajoute UN bloc',
  "```chart avec un JSON display_chart (jamais d'option ECharts brute) :",
  '{"source":{"type":"static","rows":[{"nom":"Ada","score":95}]},',
  '"chart_type":"bar","x_axis_key":"nom","x_axis_type":"category",',
  '"series":[{"data_key":"score","label":"Score"}],"title":"Scores"}.',
  'Types : bar, stacked_bar, stacked_bar_100, line, area, stacked_area,',
  'stacked_area_100, mixed (double axe), pie, donut, kpi_card, scatter, radar,',
  'table. x_axis_type : category (labels), date (YYYY-MM-DD), number.',
  'Regles : donnees LUES via tes outils uniquement, jamais inventees, 12 points',
  'max (pie/donut 6 parts). source.table = {"type":"table","tableId":"..."} pour',
  'une lecture live ; sinon static avec tes lignes lues (cles = noms de colonnes).',
  'Une serie par colonne a tracer : {"data_key":"colonne","label":"...","color":"#..."};',
  'couleurs par defaut du theme sinon. show_data_labels:true pour afficher les valeurs.',
].join('\n')

/**
 * HyperFix chat-light (Phase C) : skill stories. Luna émet un fence ```story
 * avec un JSON {action, id, title?, code?, search?, replace?} :
 * - create : nouvelle story (title + code requis, id = slug kebab-case)
 * - update : search + replace dans le code courant (nouvelle version)
 * - replace : nouveau code complet (nouvelle version)
 * Le code est du markdown avec des blocs <chart>{json display_chart}</chart>,
 * <table>{json}</table>, <grid>...</grid>, <tab title="...">...</tab>.
 */
const STORY_SKILL = [
  'Stories : pour un rapport/une page qui persiste (tableau de bord, suivi),',
  'crée une story avec UN bloc ```story {"action":"create","id":"mon-slug",',
  '"title":"Titre","code":"# Titre\\n<chart>{...}</chart>"}. Les blocs <chart> et',
  '<table> contiennent le même JSON que tes fences ```chart (données lues,',
  'jamais inventées). Un bloc <table> DOIT contenir chart_type:"table" plus',
  'un titre, ex. {"source":{...},"chart_type":"table","title":"Détails"}.',
  'Règles blocs : JSON COMPLET à chaque fois (toutes les accolades fermées),',
  '12 lignes max par bloc, jamais de JSON coupé en route.',
  'Modifie ensuite avec {"action":"update","id":"...","search":"...","replace":"..."}',
  'ou {"action":"replace","id":"...","code":"..."}. Un seul fence ```story par message.',
].join('\n')

/**
 * HyperFix chat-light (parité sim.ai) : skill tables. Luna gère les tables
 * du workspace de bout en bout : créer (avec schéma), remplir, lire,
 * modifier, supprimer. Une table créée rejoint l'inventaire au tour suivant.
 */
const TABLE_SKILL = [
  'Tables : tu peux tout faire — créer, remplir, lire, modifier, supprimer.',
  'Créer : outil create avec {"name":"nom_simple","description":"...","schema":{"columns":[{...}]}}.',
  'Colonnes : {"name":"nom","type":"string|number|boolean|date|currency"} (id auto).',
  'Remplir : insert_row / batch_insert_rows sur la table (même tour possible).',
  'IMPORTANT : dans le même tour, tu ne peux remplir que les tables de',
  "l'inventaire ci-dessus. Une table que tu viens de créer n'a pas encore",
  "d'outils liés : dis-le et remplis-la au tour suivant (elle sera à l'inventaire).",
  'Lire : query_rows (toujours avec un filtre, ex. {"nom":{"$ne":""}}), get_schema.',
  'Modifier/supprimer : update_rows_by_filter / delete_rows_by_filter, avec prudence.',
  "Ne jamais inventer de tableId : utilise l'inventaire ou viens de créer la table.",
].join('\n')

/**
 * Parité sim.ai : services connectés (toutes ops, lecture + écriture),
 * fichiers (file_v5 complet), knowledge, skills et outils customs du
 * workspace, exécution de code via Daytona (si credential connecté).
 * Tout s'exécute sans confirmation (usage solo, comme le chemin managé).
 */
const PARITY_NOTE = [
  'Capacités : tes outils couvrent tout le workspace — services connectés',
  '(lecture ET écriture : envoi, modification, suppression), fichiers (lire,',
  'chercher, écrire, ajouter), knowledge (chercher, créer, modifier), skills et',
  'outils customs du workspace, code via Daytona si connecté. Agis directement,',
  'sans demander de confirmation, et annonce ce que tu as fait après coup.',
].join('\n')

/**
 * Moteur gamme (sim-engine, MCP) : stocks, imports, rapports d'épicerie.
 * Utilise TOUJOURS ces outils quand la question touche la gamme, les rayons,
 * les stocks, les négatifs ou les rapports — jamais de réponse inventée.
 */
const GAMME_SKILL = [
  'Moteur gamme (outils sim-engine) : pour toute question stocks, rayons,',
  'négatifs, rapports, imports, utilise ces outils, dans cet ordre utile :',
  'gamme_rayons (liste), gamme_mon_rayon (mes rayons), gamme_negatifs,',
  'gamme_serie (historique), gamme_query (SQL SELECT sur gamme_commande),',
  'gamme_article (fiche code), gamme_rapports, gamme_imports, gamme_anomalies,',
  'gamme_recherche_articles, gamme_history_export, gamme_import_file,',
  'gamme_etiquettes, gamme_libeller, gamme_structure_articles, gamme_image_article.',
  'Photos produit : gamme_image_article puis fence chart_type product_image',
  'avec les lignes {image_url,...}.',
  "Règle : ne devine JAMAIS un rayon — demande ou liste d'abord.",
].join('\n')

/**
 * Récap rayon façon nao (recap-rayon.md) : recette fixe, pas d'improvisation.
 * Phase A = 5 fences ```chart imposés + interprétation ; Phase B = UNE story.
 * Adapté à nos formats (source.static avec lignes lues, fences ```story).
 */
const RECAP_SKILL = [
  'Récap rayon : quand on demande récap, fais le point, état du rayon, résumé',
  'ou story du jour — TOUJOURS Phase A (chat) PUIS Phase B (story). Chiffres',
  "uniquement lus via outils MCP, jamais inventés. D'abord gamme_mon_rayon.",
  'Phase A : 5 fences ```chart EXACTEMENT (données lues, source.static) :',
  '1. line "Négatifs — tendance" x date/jour, séries negatifs #DC2626,',
  'nouveaux #F59E0B, persistants #2563EB, hide_total true.',
  '2. area "Capital PRMP bloqué vs récupéré (FDJ)" x date/jour, séries',
  'prmp_negatif #DC2626 "Bloqué (FDJ)" et prmp_corrige #16A34A "Récupéré (FDJ)",',
  'value_format {"d3_format":",.0f","suffix":" FDJ"}.',
  '3. donut "Anomalies par type" x category/type, UNE série nb "Articles",',
  'show_data_labels true.',
  '4. bar "Top capital PRMP par article (FDJ)" x category/libelle, série',
  'valeur_prmp #DC2626 format FDJ ",.0f", show_data_labels true, tri décroissant, top 8.',
  '5. bar "Santé stock" x jour, séries en_stock #2563EB, stock_bas #F59E0B',
  '"Stock bas ≤7j", dormants #8B5CF6, hide_total true.',
  'Après CHAQUE graphique : 2-3 phrases (chiffre clé + sens + J/J-1 si dispo),',
  'codes articles cités. Montants en FDJ, jamais convertis.',
  'Phase B : UN fence ```story {"action":"create","id":"recap-<rayon>",',
  '"title":"Récap <Rayon> — <jour>","code":"..."} ; récaps suivants :',
  '{"action":"replace"} même slug (jamais de nouveau slug, jamais 2 stories).',
  'Story : markdown + blocs <chart>/<table> (JSON complet, chart_type table',
  'pour les tableaux), 5 onglets : 🎯 Dashboard, 🚨 Alertes & ruptures,',
  "💰 Marges & capital, 🛠️ Plan d'action 48 h, 📊 Lecture direction.",
].join('\n')

export function buildLunaSystemPrompt(pack: ContextePack, override?: string): string | undefined {
  const parts = [
    pack.system,
    TABLE_SKILL,
    PARITY_NOTE,
    GAMME_SKILL,
    RECAP_SKILL,
    CHART_SKILL,
    STORY_SKILL,
    (override ?? '').trim(),
  ].filter((p) => p !== '')
  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}
