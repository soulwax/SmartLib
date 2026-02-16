import "server-only"

import { neon } from "@neondatabase/serverless"
import type { NeonQueryFunction } from "@neondatabase/serverless"

import { getDatabaseEnv } from "@/lib/env"

let sqlClient: NeonQueryFunction<false, false> | null = null
let schemaReady: Promise<void> | null = null

function getSql(): NeonQueryFunction<false, false> {
  if (sqlClient !== null) {
    return sqlClient
  }

  const { DATABASE_URL } = getDatabaseEnv()
  sqlClient = neon<false, false>(DATABASE_URL)
  return sqlClient
}

export function resetDatabaseClientForTests() {
  sqlClient = null
  schemaReady = null
}

export async function ensureSchema() {
  if (schemaReady !== null) {
    await schemaReady
    return
  }

  const sql = getSql()

  schemaReady = (async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`

    await sql`
      CREATE TABLE IF NOT EXISTS resource_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT NOT NULL CHECK (char_length(category) <= 80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS resource_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id UUID NOT NULL REFERENCES resource_cards(id) ON DELETE CASCADE,
        url TEXT NOT NULL CHECK (char_length(url) <= 2048),
        label TEXT NOT NULL CHECK (char_length(label) <= 120),
        note TEXT,
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await sql`
      CREATE INDEX IF NOT EXISTS resource_cards_created_at_idx
      ON resource_cards (created_at DESC)
    `

    await sql`
      CREATE INDEX IF NOT EXISTS resource_links_resource_id_position_idx
      ON resource_links (resource_id, position)
    `

    await sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL CHECK (char_length(email) <= 320),
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
      ON app_users ((lower(email)))
    `
  })()

  await schemaReady
}

export { getSql }
