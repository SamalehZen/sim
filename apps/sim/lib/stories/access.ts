import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/** Vérifie que le chat existe dans le workspace ET que l'utilisateur y a accès. */
export async function assertChatAccess(
  userId: string,
  workspaceId: string,
  chatId: string
): Promise<{ id: string } | null> {
  const [chat] = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.workspaceId, workspaceId)))
    .limit(1)
  if (!chat) return null
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission ? chat : null
}
