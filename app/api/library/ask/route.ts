import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { askLibraryQuestion } from "@/lib/library-ask"
import { listResourcesService } from "@/lib/resource-service"

export const runtime = "nodejs"

const historyTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(500),
})

const requestSchema = z.object({
  question: z.string().trim().min(2).max(500),
  workspaceId: z.string().uuid().nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  useAi: z.boolean().optional(),
  maxCitations: z.number().int().min(1).max(8).optional(),
  history: z.array(historyTurnSchema).max(8).optional(),
})

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON.",
      },
    ])
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)

    const includeAllWorkspaces = session?.user?.isFirstAdmin === true
    const { resources } = await listResourcesService({
      userId: session?.user?.id ?? null,
      includeAllWorkspaces,
    })

    const scopedResources = resources.filter((resource) => {
      if (input.workspaceId && resource.workspaceId !== input.workspaceId) {
        return false
      }

      if (
        input.category &&
        input.category.toLowerCase() !== "all" &&
        resource.category.toLowerCase() !== input.category.toLowerCase()
      ) {
        return false
      }

      return true
    })

    const result = await askLibraryQuestion({
      question: input.question,
      resources: scopedResources,
      maxCitations: input.maxCitations,
      useAi: Boolean(input.useAi && session?.user?.id),
      history: input.history,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid ask-library payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
