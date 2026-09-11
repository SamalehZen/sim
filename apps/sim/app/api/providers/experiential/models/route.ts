import { type NextRequest, NextResponse } from 'next/server'
import { experientialProviderModelsQuerySchema } from '@/lib/api/contracts/providers'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

/**
 * HyperFix chat-light : static model list (no upstream call needed —
 * ExperientialLabs models are pinned in the provider catalog).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const queryValidation = experientialProviderModelsQuerySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get('workspaceId') ?? undefined,
  })
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const models = PROVIDER_DEFINITIONS.experiential.models.map((m) => m.id)
  return NextResponse.json({ models })
})
