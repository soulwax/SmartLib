import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import { ResourceNotFoundError } from "@/lib/resource-repository"
import { restoreResourceService } from "@/lib/resource-service"
import type { ResourceAuditActor } from "@/lib/resources"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function parseResourceId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

function auditActorFromSession(session: Awaited<ReturnType<typeof auth>>): ResourceAuditActor {
  return {
    userId: session?.user?.id ?? null,
    identifier: session?.user?.email ?? session?.user?.id ?? null,
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    if (!session.user.isAdmin) {
      return errorResponse("Admin access required.", 403)
    }

    const resourceId = await parseResourceId(context)
    const { mode, resource } = await restoreResourceService(
      resourceId,
      auditActorFromSession(session)
    )

    return NextResponse.json({ mode, resource })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid resource id.", 400)
    }

    if (error instanceof ResourceNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
