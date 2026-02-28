import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  findColorSchemePreferenceByUserId,
  findColorSchemePreferenceByVisitorId,
  upsertColorSchemePreferenceForUser,
  upsertColorSchemePreferenceForVisitor,
} from "@/lib/color-scheme-preference-repository"
import {
  DEFAULT_COLOR_SCHEME_ID,
  isColorSchemeId,
  normalizeColorSchemeId,
  type ColorSchemeId,
} from "@/lib/color-schemes"

export const runtime = "nodejs"

const VISITOR_ID_COOKIE = "dv_visitor_id"
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2

const updateSchema = z.object({
  colorSchemeId: z.string().trim().min(1).max(64),
})

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function readColorSchemeId(value: string): ColorSchemeId | null {
  const trimmed = value.trim()
  if (!isColorSchemeId(trimmed)) {
    return null
  }

  return trimmed
}

function readVisitorId(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null
  }

  const parsed = z.string().uuid().safeParse(rawValue.trim())
  return parsed.success ? parsed.data : null
}

function setVisitorCookie(response: NextResponse, visitorId: string) {
  response.cookies.set({
    name: VISITOR_ID_COOKIE,
    value: visitorId,
    httpOnly: true,
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })
}

export async function GET() {
  try {
    const session = await auth()
    const cookieStore = await cookies()
    const existingVisitorId = readVisitorId(cookieStore.get(VISITOR_ID_COOKIE)?.value)

    let colorSchemeId: ColorSchemeId = DEFAULT_COLOR_SCHEME_ID
    let visitorIdToSet: string | null = null

    if (session?.user?.id) {
      const userPreference = await findColorSchemePreferenceByUserId(session.user.id)
      if (userPreference) {
        colorSchemeId = normalizeColorSchemeId(userPreference.colorScheme)
      } else if (existingVisitorId) {
        const visitorPreference = await findColorSchemePreferenceByVisitorId(
          existingVisitorId
        )
        if (visitorPreference) {
          const adopted = normalizeColorSchemeId(visitorPreference.colorScheme)
          await upsertColorSchemePreferenceForUser(session.user.id, adopted)
          colorSchemeId = adopted
        }
      }
    } else {
      const visitorId = existingVisitorId ?? randomUUID()
      if (!existingVisitorId) {
        visitorIdToSet = visitorId
      }

      const visitorPreference = await findColorSchemePreferenceByVisitorId(visitorId)
      if (visitorPreference) {
        colorSchemeId = normalizeColorSchemeId(visitorPreference.colorScheme)
      }
    }

    const response = NextResponse.json({ colorSchemeId })
    if (visitorIdToSet) {
      setVisitorCookie(response, visitorIdToSet)
    }

    return response
  } catch {
    return errorResponse("Unexpected server error.", 500)
  }
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

export async function PUT(request: Request) {
  try {
    validateCSRF(request)

    const payload = await readRequestJson(request)
    const input = updateSchema.parse(payload)
    const colorSchemeId = readColorSchemeId(input.colorSchemeId)

    if (!colorSchemeId) {
      return errorResponse("Unsupported color scheme.", 400)
    }

    const session = await auth()
    const cookieStore = await cookies()

    let visitorIdToSet: string | null = null

    if (session?.user?.id) {
      await upsertColorSchemePreferenceForUser(session.user.id, colorSchemeId)
    } else {
      const existingVisitorId = readVisitorId(
        cookieStore.get(VISITOR_ID_COOKIE)?.value
      )
      const visitorId = existingVisitorId ?? randomUUID()

      if (!existingVisitorId) {
        visitorIdToSet = visitorId
      }

      await upsertColorSchemePreferenceForVisitor(visitorId, colorSchemeId)
    }

    const response = NextResponse.json({ ok: true, colorSchemeId })
    if (visitorIdToSet) {
      setVisitorCookie(response, visitorIdToSet)
    }

    return response
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid color scheme payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
