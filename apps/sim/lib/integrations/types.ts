/**
 * Shared types for the integrations catalog. Mirrors the JSON shape written by
 * `scripts/generate-docs.ts` → `writeIntegrationsJson()`, which is the
 * serialized projection of `BlockConfig` consumed by landing + workspace UIs.
 */

import type { BlockConfig, IntegrationTag } from '@/blocks/types'

export interface IntegrationInstallStep {
  title: string
  body: string
}

export interface IntegrationLandingContent {
  /**
   * Install walkthrough for OAuth apps whose connection lives behind sign-in.
   * Provides the "Add to {app}" instructions that app marketplaces require
   * when the install button sits behind a login.
   */
  install?: {
    heading: string
    intro: string
    steps: IntegrationInstallStep[]
  }
  /** Short data-handling summary shown next to a privacy-policy link. */
  privacy?: {
    body: string
    href: string
  }
  /**
   * Disclaimer about AI-generated content, required by some marketplaces for
   * apps with an AI component (e.g. Slack's AI-components guideline).
   */
  aiDisclaimer?: string
}

/** Normalized authentication mode surfaced in the catalog. */
export type AuthType = 'oauth' | 'api-key' | 'none'

/** Trigger entry enriched from the trigger registry at generation time. */
interface TriggerInfo {
  id: string
  name: string
  description: string
}

/** Operation entry enriched from the tool registry at generation time. */
interface OperationInfo {
  name: string
  description: string
}

/** Single FAQ item rendered on a per-integration landing page. */
export interface FAQItem {
  question: string
  answer: string
}

/**
 * Catalog projection of a `BlockConfig`. Direct `BlockConfig` fields are
 * referenced via indexed access so the two stay in lockstep; the remaining
 * fields are generation-time enrichments (see `scripts/generate-docs.ts`).
 */
export interface Integration {
  type: BlockConfig['type']
  name: BlockConfig['name']
  description: BlockConfig['description']
  longDescription: NonNullable<BlockConfig['longDescription']>
  category: BlockConfig['category']
  integrationType: NonNullable<BlockConfig['integrationType']>
  bgColor: BlockConfig['bgColor']
  /** Tags sourced from the block's `*BlockMeta` export at generation time. */
  tags?: IntegrationTag[]
  /** URL slug derived from `name`. */
  slug: string
  /** Name of the React icon component (resolved client-side via `blockTypeToIconMap`). */
  iconName: string
  /** Canonical docs URL for the integration. */
  docsUrl: string
  /** Operations enriched with descriptions from the tool registry. */
  operations: OperationInfo[]
  operationCount: number
  /** Triggers enriched with details from the trigger registry. */
  triggers: TriggerInfo[]
  triggerCount: number
  /** Authentication mode inferred from `BlockConfig.subBlocks`. */
  authType: AuthType
  /**
   * OAuth service id from the block's `oauth-input` subBlock (a service key in
   * `OAUTH_PROVIDERS`). Present exactly when `authType` is `'oauth'`.
   */
  oauthServiceId?: string
  /** Hand-authored landing content baked in at generation time (see `landing-content.ts`). */

  landingContent?: IntegrationLandingContent
}

/**
 * The fields the `/integrations` catalog grid actually renders and searches
 * by, plus a precomputed, lowercased `searchFields` index (name, description,
 * every operation's name and description, every trigger's name) in place of
 * the full `operations`/`triggers` arrays. Shipping the full `Integration[]`
 * to that page's client component embeds every integration's complete field
 * set - including data the grid never renders (`tags`, `docsUrl`,
 * `landingContent`, ...) - in the initial HTML/RSC payload.
 *
 * `searchFields` stays an array, one entry per source field, rather than a
 * single joined string: matching must still require the query to fall
 * entirely within one field (as the original per-field `Integration[]`
 * search did), not span a field boundary a single concatenated string would
 * silently allow.
 */
export interface IntegrationSummary {
  type: Integration['type']
  slug: string
  name: Integration['name']
  description: Integration['description']
  bgColor: Integration['bgColor']
  integrationType: Integration['integrationType']
  searchFields: readonly string[]
}
