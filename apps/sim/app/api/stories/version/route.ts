import { db } from '@sim/db'
import { chatStory, chatStoryVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertChatAccess } from '@/lib/stories/access'
import { validateStoryCode } from '@/lib/stories/story-code'

const logger = createLogger('StoryVersionAPI')

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const VersionBodySchema = z.object({
  workspaceId: z.string(),
  chatId: z.string(),
  action: z.enum(['create', 'update', 'replace']),
  slug: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  code: z.string().max(200000).optional(),
  search: z.string().max(200000).optional(),
  replace: z.string().max(200000).optional(),
})

// POST - create / update / replace une story (nouvelle version à chaque écriture).
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await enforceUserRateLimit('stories-version', session.user.id)
    if (rateLimited) return rateLimited

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsedBody = VersionBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { workspaceId, chatId, action, slug, title, code, search, replace } = parsedBody.data

    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'Slug must be kebab-case' }, { status: 400 })
    }
    if (!(await assertChatAccess(session.user.id, workspaceId, chatId))) {
      return NextResponse.json({ error: 'Access denied to this chat' }, { status: 403 })
    }

    const [existing] = await db
      .select({ id: chatStory.id, title: chatStory.title })
      .from(chatStory)
      .where(and(eq(chatStory.chatId, chatId), eq(chatStory.slug, slug)))
      .limit(1)

    let storyId: string
    let finalTitle: string
    let nextCode: string

    if (action === 'create') {
      if (existing) {
        return NextResponse.json(
          { error: 'Story already exists, use update or replace' },
          { status: 409 }
        )
      }
      if (!title || !code) {
        return NextResponse.json(
          { error: 'Title and code are required for create' },
          { status: 400 }
        )
      }
      const validation = validateStoryCode(code)
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
      const [created] = await db
        .insert(chatStory)
        .values({ chatId, slug, title, createdBy: session.user.id })
        .returning({ id: chatStory.id })
      storyId = created.id
      finalTitle = title
      nextCode = code
    } else {
      if (!existing) {
        return NextResponse.json({ error: 'Story not found' }, { status: 404 })
      }
      storyId = existing.id
      finalTitle = title ?? existing.title
      const [latest] = await db
        .select({ version: chatStoryVersion.version, code: chatStoryVersion.code })
        .from(chatStoryVersion)
        .where(eq(chatStoryVersion.storyId, storyId))
        .orderBy(desc(chatStoryVersion.version))
        .limit(1)
      const currentCode = latest?.code ?? ''
      if (action === 'replace') {
        if (!code) {
          return NextResponse.json({ error: 'Code is required for replace' }, { status: 400 })
        }
        nextCode = code
      } else {
        if (!search || replace === undefined) {
          return NextResponse.json(
            { error: 'Search and replace are required for update' },
            { status: 400 }
          )
        }
        if (!currentCode.includes(search)) {
          return NextResponse.json(
            { error: 'Search text not found in current story' },
            { status: 400 }
          )
        }
        nextCode = currentCode.replace(search, replace)
      }
      const validation = validateStoryCode(nextCode)
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
      if (title && title !== existing.title) {
        await db
          .update(chatStory)
          .set({ title, updatedAt: new Date() })
          .where(eq(chatStory.id, storyId))
      }
    }

    const [latestVersion] = await db
      .select({ version: chatStoryVersion.version })
      .from(chatStoryVersion)
      .where(eq(chatStoryVersion.storyId, storyId))
      .orderBy(desc(chatStoryVersion.version))
      .limit(1)
    const version = (latestVersion?.version ?? 0) + 1

    await db.insert(chatStoryVersion).values({
      storyId,
      version,
      code: nextCode,
      createdBy: session.user.id,
    })

    return NextResponse.json({
      success: true,
      id: slug,
      version,
      code: nextCode,
      title: finalTitle,
    })
  } catch (error) {
    logger.error('Error writing story version', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
