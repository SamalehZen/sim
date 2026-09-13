/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import { parseStoryFence } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/story-card'

describe('story fence', () => {
  it('parses a create fence', () => {
    const fence = parseStoryFence(
      JSON.stringify({ action: 'create', id: 'mon-slug', title: 'Titre', code: '# Titre' })
    )
    expect(fence).toMatchObject({ action: 'create', id: 'mon-slug', title: 'Titre' })
  })

  it('parses an update fence', () => {
    const fence = parseStoryFence(
      JSON.stringify({ action: 'update', id: 'mon-slug', search: 'a', replace: 'b' })
    )
    expect(fence).toMatchObject({ action: 'update', search: 'a', replace: 'b' })
  })

  it('rejects invalid fences', () => {
    expect(parseStoryFence('not json')).toBeNull()
    expect(parseStoryFence(JSON.stringify({ action: 'delete', id: 'x' }))).toBeNull()
    expect(parseStoryFence(JSON.stringify({ action: 'create', id: '' }))).toBeNull()
  })

  it('keeps a ```story fence intact through chat sanitizing', () => {
    const message = 'Voici le rapport :\n```story\n{"action":"create","id":"x"}\n```\n'
    expect(sanitizeChatDisplayContent(message)).toBe(message)
  })
})
