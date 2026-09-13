'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'

export interface StoryFence {
  action: 'create' | 'update' | 'replace'
  id: string
  title?: string
  code?: string
  search?: string
  replace?: string
}

interface StoryServerState {
  title: string
  version: number | null
}

/**
 * HyperFix chat-light (Phase C) : carte story dans le fil, façon nao
 * (`StoryToolCall`) — titre, statut, version live, bouton d'ouverture.
 *
 * Exécution : les fences ```story de Luna s'exécutent ici, au rendu
 * (les tool calls n'ont pas de rendu UI dans la boucle locale) — create si
 * absente, update/replace si le code courant l'exige encore. Gardes serveur
 * (409, comparaison de code) rendent l'opération idempotente aux remontages.
 * L'ouverture émet `story-open` (écouté par le side panel, lot C-c).
 */
export const StoryCard = memo(function StoryCard({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const params = useParams<{ workspaceId?: string; chatId?: string }>()
  const workspaceId = params?.workspaceId
  const chatId = params?.chatId

  const fence = useMemo(() => parseStoryFence(content), [content])
  const [server, setServer] = useState<StoryServerState | null>(null)
  const [execError, setExecError] = useState<string | null>(null)
  const executedRef = useRef(false)

  useEffect(() => {
    if (!fence || isStreaming || !workspaceId || !chatId || executedRef.current) return
    executedRef.current = true
    let active = true

    const load = async () => {
      const listRes = await fetch(
        `/api/stories?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(chatId)}&slug=${encodeURIComponent(fence.id)}`
      )
      if (!active) return
      if (!listRes.ok) {
        setExecError(`Stories unavailable (${listRes.status})`)
        return
      }
      const data = await listRes.json()
      const story = data?.stories?.[0] as
        | { title: string; latest: { version: number; code: string } | null }
        | undefined

      const postVersion = async (body: Record<string, unknown>) => {
        const res = await fetch('/api/stories/version', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, chatId, slug: fence.id, ...body }),
        })
        if (!active) return null
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          // 409 sur create = déjà créée entre-temps (double mount) : pas une erreur.
          if (!(fence.action === 'create' && res.status === 409)) {
            setExecError(typeof err?.error === 'string' ? err.error : `Save failed (${res.status})`)
          }
          return null
        }
        return (await res.json()) as { version: number; title: string }
      }

      if (!story) {
        if (fence.action !== 'create' || !fence.title || !fence.code) {
          setExecError(
            fence.action === 'create'
              ? 'Story creation needs a title and code'
              : 'Story not found for update'
          )
          return
        }
        const created = await postVersion({
          action: 'create',
          title: fence.title,
          code: fence.code,
        })
        if (created && active) setServer({ title: created.title, version: created.version })
        return
      }

      setServer({ title: story.title, version: story.latest?.version ?? null })
      const currentCode = story.latest?.code ?? ''
      if (fence.action === 'update' && fence.search !== undefined && fence.replace !== undefined) {
        if (!currentCode.includes(fence.search)) return
        const updated = await postVersion({
          action: 'update',
          search: fence.search,
          replace: fence.replace,
        })
        if (updated && active) setServer({ title: updated.title, version: updated.version })
      } else if (fence.action === 'replace' && fence.code !== undefined) {
        if (currentCode === fence.code) return
        const updated = await postVersion({ action: 'replace', code: fence.code })
        if (updated && active) setServer({ title: updated.title, version: updated.version })
      }
    }

    load().catch(() => {
      if (active) setExecError('Story execution failed')
    })
    return () => {
      active = false
    }
  }, [fence, isStreaming, workspaceId, chatId])

  if (!fence) {
    if (isStreaming) {
      return (
        <div
          data-testid='story-card-loading'
          className='not-prose my-2 h-16 w-full animate-pulse rounded-lg bg-[var(--surface-4)]'
        />
      )
    }
    return (
      <div
        data-testid='story-card-error'
        className='not-prose my-2 rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--text-error)]'
      >
        Invalid story block.
      </div>
    )
  }

  const title = server?.title ?? fence.title ?? fence.id
  const status = isStreaming
    ? fence.action === 'create'
      ? 'Creating...'
      : fence.action === 'update'
        ? 'Updating...'
        : 'Replacing...'
    : `${actionLabel(fence.action)}${server?.version ? ` · v${server.version}` : ''}`

  const canOpen = Boolean(chatId && !isStreaming)
  const openStory = () => {
    if (!canOpen) return
    window.dispatchEvent(new CustomEvent('story-open', { detail: { slug: fence.id } }))
  }

  return (
    <div
      data-testid='story-card'
      className='not-prose group my-2 flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-[var(--border)] bg-transparent pr-3 text-left transition-colors hover-hover:bg-[var(--surface-4)]'
      onClick={openStory}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && canOpen) {
          e.preventDefault()
          openStory()
        }
      }}
      role='button'
      tabIndex={canOpen ? 0 : -1}
    >
      <div className='flex h-16 w-24 shrink-0 items-center justify-center bg-[var(--surface-4)] text-[var(--text-tertiary)] text-xs'>
        story
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-1 py-3'>
        <span className='truncate font-medium text-sm'>{title}</span>
        <span className='text-[var(--text-muted)] text-xs'>{status}</span>
        {execError && (
          <span className='text-[var(--text-error)] text-xs' role='alert'>
            {execError}
          </span>
        )}
      </div>
      {canOpen && (
        <Button
          variant='ghost'
          size='icon'
          className='rounded-full'
          title='Open story'
          tabIndex={-1}
        >
          <ArrowUpRight className='size-3.5' />
        </Button>
      )}
    </div>
  )
})

function actionLabel(action: StoryFence['action']): string {
  if (action === 'create') return 'Created'
  if (action === 'update') return 'Updated'
  return 'Replaced'
}

export function parseStoryFence(content: string): StoryFence | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const fence = raw as Record<string, unknown>
  if (fence.action !== 'create' && fence.action !== 'update' && fence.action !== 'replace') {
    return null
  }
  if (typeof fence.id !== 'string' || fence.id.trim() === '') return null
  return {
    action: fence.action,
    id: fence.id,
    ...(typeof fence.title === 'string' ? { title: fence.title } : {}),
    ...(typeof fence.code === 'string' ? { code: fence.code } : {}),
    ...(typeof fence.search === 'string' ? { search: fence.search } : {}),
    ...(typeof fence.replace === 'string' ? { replace: fence.replace } : {}),
  }
}
