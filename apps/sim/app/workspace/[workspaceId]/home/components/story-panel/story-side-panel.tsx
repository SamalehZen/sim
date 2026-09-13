'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import { Button } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { StoryPreview } from './story-preview'

interface StoryData {
  id: string
  slug: string
  title: string
  latest: { version: number; code: string; createdAt: string } | null
  versions?: { version: number; code: string; createdAt: string }[]
}

/**
 * HyperFix chat-light (Phase C) : panneau latéral story, façon nao
 * (`StoryViewer`) — s'ouvre via l'événement `story-open` émis par les cartes
 * story et (lot C-e) le bouton add-to-story des graphiques.
 */
export const StorySidePanel = memo(function StorySidePanel() {
  const params = useParams<{ workspaceId?: string; chatId?: string }>()
  const workspaceId = params?.workspaceId
  const chatId = params?.chatId

  const [slug, setSlug] = useState<string | null>(null)
  const [story, setStory] = useState<StoryData | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const close = useCallback(() => {
    setSlug(null)
    setStory(null)
    setVersion(null)
    setError(null)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { slug?: string } | undefined
      if (detail?.slug) {
        setSlug(detail.slug)
        setVersion(null)
        setError(null)
      }
    }
    window.addEventListener('story-open', handler)
    return () => window.removeEventListener('story-open', handler)
  }, [])

  useEffect(() => {
    if (!slug || !workspaceId || !chatId) return
    let active = true
    setLoading(true)
    fetch(
      `/api/stories?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(chatId)}&slug=${encodeURIComponent(slug)}&includeVersions=true`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return
        const found = data?.stories?.[0] as StoryData | undefined
        if (!found) {
          setError('Story not found')
          setStory(null)
        } else {
          setStory(found)
          setError(null)
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not load story')
          setStory(null)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [slug, workspaceId, chatId])

  if (!slug) return null

  const activeVersion = version ?? story?.latest?.version ?? null

  return (
    <div
      data-testid='story-side-panel'
      className='flex h-full w-[520px] max-w-[45vw] flex-none flex-col border-[var(--border)] border-l bg-[var(--bg)]'
    >
      <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-semibold text-sm'>{story?.title ?? slug}</span>
          {activeVersion !== null && (
            <span className='text-[var(--text-muted)] text-xs'>v{activeVersion}</span>
          )}
        </div>
        {story?.versions && story.versions.length > 1 && (
          <select
            value={activeVersion ?? ''}
            onChange={(e) => setVersion(Number(e.target.value))}
            className='rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-xs'
            aria-label='Version'
          >
            {story.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        )}
        <Button
          variant='ghost'
          size='icon'
          className='rounded-full'
          onClick={close}
          title='Close story'
        >
          <X className='size-4' />
        </Button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        {loading && <div className='h-40 w-full animate-pulse rounded-lg bg-[var(--surface-4)]' />}
        {error && (
          <div className='rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--text-error)]'>
            {error}
          </div>
        )}
        {!loading && !error && !story?.latest && (
          <div className='text-sm text-[var(--text-secondary)]'>No versions yet.</div>
        )}
        {!loading && !error && story?.latest && activeVersion !== null && (
          <StoryPreview
            key={activeVersion}
            code={
              story.versions?.find((v) => v.version === activeVersion)?.code ?? story.latest.code
            }
          />
        )}
      </div>
    </div>
  )
})
