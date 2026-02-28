import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { appendAskLibraryThreadInteraction } from "@/lib/ask-library-thread-repository"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import { hasDatabaseEnv } from "@/lib/env"
import { askLibraryQuestion } from "@/lib/library-ask"
import { listResourcesService } from "@/lib/resource-service"

export const runtime = "nodejs"

const historyTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(500),
})

const requestSchema = z.object({
  question: z.string().trim().min(2).max(500),
  threadId: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  scopeWorkspace: z.boolean().optional(),
  scopeCategory: z.boolean().optional(),
  scopeTags: z.boolean().optional(),
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
    validateCSRF(request)

    const session = await auth()
    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)

    const includeAllWorkspaces = session?.user?.isFirstAdmin === true
    const { resources } = await listResourcesService({
      userId: session?.user?.id ?? null,
      includeAllWorkspaces,
    })
    const scopeWorkspace = input.scopeWorkspace !== false
    const scopeCategory = input.scopeCategory !== false
    const scopeTags = input.scopeTags === true
    const scopedTagSet = new Set(
      (scopeTags ? input.tags ?? [] : [])
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
    )

    const scopedResources = resources.filter((resource) => {
      if (
        scopeWorkspace &&
        input.workspaceId &&
        resource.workspaceId !== input.workspaceId
      ) {
        return false
      }

      if (
        scopeCategory &&
        input.category &&
        input.category.toLowerCase() !== "all" &&
        resource.category.toLowerCase() !== input.category.toLowerCase()
      ) {
        return false
      }

      if (scopedTagSet.size > 0) {
        const hasMatchingTag = resource.tags.some((tag) =>
          scopedTagSet.has(tag.toLowerCase())
        )
        if (!hasMatchingTag) {
          return false
        }
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

    let threadId = input.threadId ?? null
    let threadTitle: string | null = null

    if (session?.user?.id && hasDatabaseEnv()) {
      try {
        const persisted = await appendAskLibraryThreadInteraction({
          userId: session.user.id,
          threadId: input.threadId,
          workspaceId: input.workspaceId ?? null,
          question: result.question,
          answer: result.answer,
          usedAi: result.usedAi,
          model: result.model,
          citations: result.citations,
          reasoning: result.reasoning,
          followUpSuggestions: result.followUpSuggestions,
        })
        threadId = persisted.id
        threadTitle = persisted.title
      } catch (persistError) {
        console.error(
          "Ask Library thread persistence failed:",
          persistError instanceof Error ? persistError.message : persistError
        )
      }
    }

    return NextResponse.json({
      ...result,
      threadId,
      threadTitle,
    })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

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
