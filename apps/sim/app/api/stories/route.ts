import { db } from '@sim/db'
import { chatStory, chatStoryVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertChatAccess } from '@/lib/stories/access'

const logger = createLogger('StoriesAPI')

// GET - Liste les stories d'un chat avec leur dernière version.
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId') ?? ''
    const chatId = searchParams.get('chatId') ?? ''
    const slug = searchParams.get('slug') ?? ''
    if (!workspaceId || !chatId) {
      return NextResponse.json({ error: 'workspaceId and chatId are required' }, { status: 400 })
    }

    const permission = await assertChatAccess(session.user.id, workspaceId, chatId)
    if (!permission) {
      return NextResponse.json({ error: 'Access denied to this chat' }, { status: 403 })
    }

    const stories = await db
      .select({
        id: chatStory.id,
        slug: chatStory.slug,
        title: chatStory.title,
        updatedAt: chatStory.updatedAt,
      })
      .from(chatStory)
      .where(and(eq(chatStory.chatId, chatId), slug ? eq(chatStory.slug, slug) : undefined))
      .orderBy(desc(chatStory.updatedAt))

    const withLatest = await Promise.all(
      stories.map(async (story) => {
        const [latest] = await db
          .select({
            version: chatStoryVersion.version,
            code: chatStoryVersion.code,
            createdAt: chatStoryVersion.createdAt,
          })
          .from(chatStoryVersion)
          .where(eq(chatStoryVersion.storyId, story.id))
          .orderBy(desc(chatStoryVersion.version))
          .limit(1)
        return { ...story, latest: latest ?? null }
      })
    )

    return NextResponse.json({ stories: withLatest })
  } catch (error) {
    logger.error('Error listing stories', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
