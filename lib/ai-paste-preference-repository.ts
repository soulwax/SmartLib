import "server-only"

import { eq, sql } from "drizzle-orm"

import { aiPastePreferences } from "@/lib/db-schema"
import { ensureSchema, getDb } from "@/lib/db"

export type AiPastePromptDecision = "accepted" | "declined"

export interface AiPastePreferenceRecord {
  userId: string
  decision: AiPastePromptDecision
  createdAt: string
  updatedAt: string
}

type PreferenceRow = {
  userId: string
  decision: string
  createdAt: Date | string
  updatedAt: Date | string
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function normalizeDecision(value: string): AiPastePromptDecision {
  return value === "accepted" ? "accepted" : "declined"
}

function normalizeRow(row: PreferenceRow): AiPastePreferenceRecord {
  return {
    userId: row.userId,
    decision: normalizeDecision(row.decision),
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  }
}

export async function findAiPastePreferenceByUserId(
  userId: string
): Promise<AiPastePreferenceRecord | null> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      userId: aiPastePreferences.userId,
      decision: aiPastePreferences.decision,
      createdAt: aiPastePreferences.createdAt,
      updatedAt: aiPastePreferences.updatedAt,
    })
    .from(aiPastePreferences)
    .where(eq(aiPastePreferences.userId, userId))
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return normalizeRow(rows[0] as PreferenceRow)
}

export async function upsertAiPastePreferenceForUser(
  userId: string,
  decision: AiPastePromptDecision
): Promise<AiPastePreferenceRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .insert(aiPastePreferences)
    .values({
      userId,
      decision,
    })
    .onConflictDoUpdate({
      target: aiPastePreferences.userId,
      set: {
        decision,
        updatedAt: sql`NOW()`,
      },
    })
    .returning({
      userId: aiPastePreferences.userId,
      decision: aiPastePreferences.decision,
      createdAt: aiPastePreferences.createdAt,
      updatedAt: aiPastePreferences.updatedAt,
    })

  const updated = rows[0]
  if (!updated) {
    throw new Error("Failed to upsert AI paste preference.")
  }

  return normalizeRow(updated as PreferenceRow)
}
