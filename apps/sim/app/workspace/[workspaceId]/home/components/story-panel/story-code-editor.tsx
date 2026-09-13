'use client'

import { memo, useState } from 'react'
import { Button } from '@sim/emcn'
import { validateStoryCode } from '@/lib/stories/story-code'

/**
 * HyperFix chat-light (Phase C) : édition directe du code story
 * (sauvegarde = nouvelle version via replace).
 */
export const StoryCodeEditor = memo(function StoryCodeEditor({
  code,
  onSave,
}: {
  code: string
  onSave: (code: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(code)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const validation = validateStoryCode(draft)

  const handleSave = async () => {
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    if (draft === code) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className='min-h-[300px] flex-1 resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[13px] leading-[1.6]'
        aria-label='Story code'
      />
      {!validation.ok && (
        <p className='text-[var(--text-error)] text-xs' role='alert'>
          {validation.error}
        </p>
      )}
      {error && (
        <p className='text-[var(--text-error)] text-xs' role='alert'>
          {error}
        </p>
      )}
      <div className='flex justify-end'>
        <Button
          variant='primary'
          size='sm'
          className='rounded-full'
          disabled={saving || !validation.ok || draft === code}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save new version'}
        </Button>
      </div>
    </div>
  )
})
