'use client'

import { useEffect, useState } from 'react'

/**
 * HyperFix chat-light (Phase C) : slugs des stories d'un chat (équivalent
 * nao `useStoryIds`, pour le bouton add-to-story des graphiques).
 * Cache module (30 s) : un message à N graphiques ne déclenche qu'un fetch.
 */
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; slugs: string[] }>()

/** Invalide le cache (après création d'une story, ex. StoryCard). */
export function invalidateChatStorySlugs(workspaceId: string, chatId: string): void {
  cache.delete(`${workspaceId}:${chatId}`)
}

export function useChatStorySlugs(
  workspaceId: string | undefined,
  chatId: string | undefined
): string[] {
  const [slugs, setSlugs] = useState<string[]>([])

  useEffect(() => {
    if (!workspaceId || !chatId) {
      setSlugs([])
      return
    }
    const key = `${workspaceId}:${chatId}`
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setSlugs(cached.slugs)
      return
    }
    let active = true
    fetch(
      `/api/stories?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(chatId)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.stories) ? data.stories : []
        const next = list.map((s: { slug: string }) => s.slug).filter(Boolean)
        cache.set(key, { at: Date.now(), slugs: next })
        setSlugs(next)
      })
      .catch(() => {
        if (active) setSlugs([])
      })
    return () => {
      active = false
    }
  }, [workspaceId, chatId])

  return slugs
}
