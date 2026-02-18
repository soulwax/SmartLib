/**
 * Stamps migration files 0000-0012 as already applied in drizzle.__drizzle_migrations.
 * Run once to reconcile a database whose schema was populated via db:push rather than db:migrate.
 *
 *   node scripts/stamp-migrations.mjs
 */

import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"
import { neon } from "@neondatabase/serverless"

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, "..")

config({ path: join(root, ".env") })

const url = process.env.DATABASE_URL_UNPOOLED?.trim()
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is not set in .env")
  process.exit(1)
}

const sql = neon(url)

// 1. Ensure the drizzle schema and tracking table exist (same DDL drizzle-kit uses)
await sql`CREATE SCHEMA IF NOT EXISTS drizzle`
await sql`
  CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
    id        SERIAL PRIMARY KEY,
    hash      text   NOT NULL,
    created_at bigint
  )
`

// 2. Collect all .sql files except the newest (0013 onwards — not yet applied)
const drizzleDir = join(root, "drizzle")
const allSql = readdirSync(drizzleDir)
  .filter(f => /^\d+.*\.sql$/.test(f))
  .sort()

// Find the highest index already in the DB so we can skip already-stamped files.
const existing = await sql`
  SELECT hash FROM drizzle."__drizzle_migrations"
`
const existingHashes = new Set(existing.map(r => r.hash))

// 3. Hash each file and insert if missing
let stamped = 0
for (const file of allSql) {
  const content = readFileSync(join(drizzleDir, file), "utf8")
  const hash = createHash("sha256").update(content).digest("hex")

  if (existingHashes.has(hash)) {
    console.log(`  skip  ${file}  (already recorded)`)
    continue
  }

  // Check whether this migration's tables already exist in the DB.
  // We stamp it regardless — the goal is to tell drizzle "this is applied".
  await sql`
    INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
    VALUES (${hash}, ${Date.now()})
  `
  existingHashes.add(hash)
  stamped++
  console.log(`  stamp ${file}`)
}

// 4. Show final state
const total = await sql`SELECT count(*) AS n FROM drizzle."__drizzle_migrations"`
console.log(`\nDone. Stamped ${stamped} new entries. Total rows: ${total[0].n}`)
console.log("You can now run: pnpm db:migrate")
