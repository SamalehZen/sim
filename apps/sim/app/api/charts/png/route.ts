import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { InputSchema, isBuiltinChartType, isChartInput } from '@/lib/charts/nao/display-chart'
import { generateChartImage } from '@/lib/charts/nao/server-render'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ChartPngAPI')

/** Cap server-side PNG rows (charts aggregate visually well under it). */
const PNG_ROWS_MAX = 2000

const PngBodySchema = z.object({
  workspaceId: z.string(),
  input: z.unknown(),
  rows: z.array(z.record(z.string(), z.unknown())).max(PNG_ROWS_MAX).optional(),
})

// POST - Render a chat chart to PNG (server-side, like nao `chart.download`).
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
    const parsedBody = PngBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { workspaceId, input: rawInput, rows } = parsedBody.data

    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )
    if (!workspacePermission) {
      return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
    }

    const parsedInput = InputSchema.safeParse(rawInput)
    if (!parsedInput.success) {
      return NextResponse.json({ error: 'Invalid chart input' }, { status: 400 })
    }
    const input = parsedInput.data
    if (input.chart_type === 'table') {
      return NextResponse.json(
        { error: 'PNG download is only available for chart visualizations' },
        { status: 400 }
      )
    }
    if (!isChartInput(input) || !isBuiltinChartType(input.chart_type)) {
      return NextResponse.json(
        { error: 'PNG download is only available for built-in charts' },
        { status: 400 }
      )
    }

    const data = rows ?? []
    if (data.length === 0) {
      return NextResponse.json({ error: 'No data to render' }, { status: 400 })
    }

    const png = generateChartImage({ config: { ...input, chart_type: input.chart_type }, data })
    const bytes = new Uint8Array(png)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logger.error('Error rendering chart PNG', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
