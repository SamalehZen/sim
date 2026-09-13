'use client'

import { useEffect, useState } from 'react'

/**
 * HyperFix chat-light (Phase C) : slugs des stories d'un chat (équivalent
 * nao `useStoryIds`, pour le bouton add-to-story des graphiques).
 */
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
    let active = true
    fetch(
      `/api/stories?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(chatId)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.stories) ? data.stories : []
        setSlugs(list.map((s: { slug: string }) => s.slug).filter(Boolean))
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
