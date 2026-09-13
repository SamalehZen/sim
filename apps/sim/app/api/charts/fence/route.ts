import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { InputSchema } from '@/lib/charts/nao/display-chart'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ChartFenceAPI')

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

const FenceBodySchema = z.object({
  workspaceId: z.string(),
  oldFence: z.string().min(1).max(200000),
  newFence: z.string().min(1).max(200000),
})

// POST - Persist a chart edit by rewriting its ```chart fence inside the
// latest matching assistant message (nao `chart.updateConfig` equivalent,
// adapted: config lives in message content, not in a tool-call row).
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsedBody = FenceBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { workspaceId, oldFence, newFence } = parsedBody.data

    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )
    if (!workspacePermission) {
      return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
    }

    const fenceJson = newFence.replace(/^```chart\s*/, '').replace(/```\s*$/, '')
    let fenceRaw: unknown
    try {
      fenceRaw = JSON.parse(fenceJson.trim())
    } catch {
      return NextResponse.json({ error: 'New fence is not valid JSON' }, { status: 400 })
    }
    if (!InputSchema.safeParse(fenceRaw).success) {
      return NextResponse.json({ error: 'New fence is not a valid chart input' }, { status: 400 })
    }

    const [match] = await db
      .select({ id: copilotMessages.id, content: copilotMessages.content })
      .from(copilotMessages)
      .innerJoin(copilotChats, eq(copilotMessages.chatId, copilotChats.id))
      .where(
        and(
          eq(copilotChats.workspaceId, workspaceId),
          eq(copilotMessages.role, 'assistant'),
          isNull(copilotMessages.deletedAt),
          // Échappe les wildcards LIKE (noms de colonnes avec _notamment).
          sql`${copilotMessages.content}::text LIKE ${`%${escapeLike(oldFence)}%`} ESCAPE '\\'`
        )
      )
      .orderBy(desc(copilotMessages.createdAt))
      .limit(1)

    if (!match) {
      return NextResponse.json({ error: 'Chart message not found' }, { status: 404 })
    }

    const content = (match.content ?? {}) as Record<string, unknown>
    const text = typeof content.content === 'string' ? content.content : null
    if (!text || !text.includes(oldFence)) {
      return NextResponse.json({ error: 'Chart fence not found in message' }, { status: 404 })
    }

    await db
      .update(copilotMessages)
      .set({
        content: { ...content, content: text.replace(oldFence, newFence) },
        updatedAt: new Date(),
      })
      .where(eq(copilotMessages.id, match.id))

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error persisting chart edit', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
