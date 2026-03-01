#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { config } from "dotenv"
import { neon } from "@neondatabase/serverless"

const TABLE_ORDER = [
  "public.app_users",
  "public.resource_organizations",
  "public.resource_workspaces",
  "public.resource_categories",
  "public.resource_tags",
  "public.resource_cards",
  "public.resource_links",
  "public.resource_card_tags",
  "public.email_verification_tokens",
  "public.password_reset_tokens",
  "public.color_scheme_preferences",
  "public.ai_paste_preferences",
  "public.ask_library_threads",
  "public.resource_audit_logs",
  "public.favicon_cache",
]

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

config({ path: join(root, ".env"), quiet: true })
if (existsSync(join(root, ".env.local"))) {
  config({ path: join(root, ".env.local"), override: true, quiet: true })
}

const sourceUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim()

if (!sourceUrl) {
  console.error("DATABASE_URL or DATABASE_URL_UNPOOLED must be set in .env/.env.local")
  process.exit(1)
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`
}

function parseQualifiedTable(qualifiedName) {
  const [schema, table] = qualifiedName.split(".")
  if (!schema || !table) {
    throw new Error(`Invalid table name: ${qualifiedName}`)
  }
  return { schema, table }
}

function qualifiedIdent(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function parseArgs(argv) {
  const command = argv[0] ?? "drill"
  const options = {
    output: null,
    input: null,
    targetUrl: null,
    dryRun: false,
    confirm: null,
    allowSourceDb: false,
  }

  for (let index = 1; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === "--") {
      continue
    }
    if (part === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (part === "--allow-source-db") {
      options.allowSourceDb = true
      continue
    }
    if (part === "--output" || part === "--input" || part === "--target-url" || part === "--confirm") {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`Missing value for ${part}`)
      }
      index += 1
      if (part === "--output") {
        options.output = value
      } else if (part === "--input") {
        options.input = value
      } else if (part === "--target-url") {
        options.targetUrl = value
      } else if (part === "--confirm") {
        options.confirm = value
      }
      continue
    }

    throw new Error(`Unknown argument: ${part}`)
  }

  return { command, options }
}

async function getTableColumns(sql, schema, table) {
  const rows = await sql.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `,
    [schema, table],
  )

  return rows.map((row) => row.column_name)
}

async function getPrimaryKeyColumns(sql, schema, table) {
  const rows = await sql.query(
    `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary
        AND n.nspname = $1
        AND c.relname = $2
      ORDER BY array_position(i.indkey, a.attnum)
    `,
    [schema, table],
  )

  return rows.map((row) => row.column_name)
}

async function createBackupSnapshot(sql) {
  const tables = {}
  const summary = []

  for (const qualifiedTable of TABLE_ORDER) {
    const { schema, table } = parseQualifiedTable(qualifiedTable)
    const columns = await getTableColumns(sql, schema, table)

    if (columns.length === 0) {
      throw new Error(`Table not found in source database: ${qualifiedTable}`)
    }

    const primaryKeyColumns = await getPrimaryKeyColumns(sql, schema, table)
    const orderByClause =
      primaryKeyColumns.length > 0
        ? ` ORDER BY ${primaryKeyColumns.map((column) => quoteIdent(column)).join(", ")}`
        : ""

    const rowsResult = await sql.query(
      `SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM (SELECT * FROM ${qualifiedIdent(schema, table)}${orderByClause}) AS t`,
    )

    const rows = rowsResult[0]?.rows ?? []

    tables[qualifiedTable] = {
      columns,
      primaryKeyColumns,
      rows,
    }

    summary.push({ table: qualifiedTable, rowCount: rows.length })
  }

  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      provider: "postgres",
      mode: "logical-json",
    },
    tableOrder: TABLE_ORDER,
    tables,
    summary,
  }
}

function loadSnapshot(inputPath) {
  const raw = readFileSync(inputPath, "utf8")
  const parsed = JSON.parse(raw)

  if (parsed?.formatVersion !== 1) {
    throw new Error("Unsupported backup format version.")
  }
  if (!Array.isArray(parsed?.tableOrder) || typeof parsed?.tables !== "object" || parsed.tables === null) {
    throw new Error("Backup file is missing table metadata.")
  }

  return parsed
}

function validateSnapshot(snapshot) {
  const issues = []

  for (const tableName of TABLE_ORDER) {
    const tablePayload = snapshot.tables[tableName]
    if (!tablePayload) {
      issues.push(`Missing table payload: ${tableName}`)
      continue
    }

    if (!Array.isArray(tablePayload.columns) || tablePayload.columns.length === 0) {
      issues.push(`Table has no column metadata: ${tableName}`)
    }

    if (!Array.isArray(tablePayload.rows)) {
      issues.push(`Table rows are not an array: ${tableName}`)
      continue
    }

    const columnSet = new Set(tablePayload.columns)
    for (const row of tablePayload.rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        issues.push(`Table contains non-object row: ${tableName}`)
        continue
      }

      for (const key of Object.keys(row)) {
        if (!columnSet.has(key)) {
          issues.push(`Row contains unknown column '${key}' in ${tableName}`)
        }
      }
    }
  }

  const idSets = {
    appUsers: new Set((snapshot.tables["public.app_users"]?.rows ?? []).map((row) => row.id)),
    organizations: new Set((snapshot.tables["public.resource_organizations"]?.rows ?? []).map((row) => row.id)),
    workspaces: new Set((snapshot.tables["public.resource_workspaces"]?.rows ?? []).map((row) => row.id)),
    categories: new Set((snapshot.tables["public.resource_categories"]?.rows ?? []).map((row) => row.id)),
    resources: new Set((snapshot.tables["public.resource_cards"]?.rows ?? []).map((row) => row.id)),
    tags: new Set((snapshot.tables["public.resource_tags"]?.rows ?? []).map((row) => row.id)),
  }

  function assertForeignKey(tableName, fieldName, allowedSet, options) {
    const rows = snapshot.tables[tableName]?.rows ?? []
    for (const row of rows) {
      const value = row[fieldName]
      if (value === null || typeof value === "undefined") {
        if (options?.nullable) {
          continue
        }
        issues.push(`Null required foreign key ${tableName}.${fieldName}`)
        continue
      }
      if (!allowedSet.has(value)) {
        issues.push(`Broken foreign key ${tableName}.${fieldName} -> ${String(value)}`)
      }
    }
  }

  assertForeignKey("public.resource_organizations", "owner_user_id", idSets.appUsers, { nullable: true })
  assertForeignKey("public.resource_workspaces", "organization_id", idSets.organizations, { nullable: false })
  assertForeignKey("public.resource_workspaces", "owner_user_id", idSets.appUsers, { nullable: true })
  assertForeignKey("public.resource_categories", "workspace_id", idSets.workspaces, { nullable: false })
  assertForeignKey("public.resource_categories", "owner_user_id", idSets.appUsers, { nullable: true })
  assertForeignKey("public.resource_cards", "workspace_id", idSets.workspaces, { nullable: false })
  assertForeignKey("public.resource_cards", "category_id", idSets.categories, { nullable: true })
  assertForeignKey("public.resource_cards", "owner_user_id", idSets.appUsers, { nullable: true })
  assertForeignKey("public.resource_links", "resource_id", idSets.resources, { nullable: false })
  assertForeignKey("public.resource_card_tags", "resource_id", idSets.resources, { nullable: false })
  assertForeignKey("public.resource_card_tags", "tag_id", idSets.tags, { nullable: false })
  assertForeignKey("public.email_verification_tokens", "user_id", idSets.appUsers, { nullable: false })
  assertForeignKey("public.password_reset_tokens", "user_id", idSets.appUsers, { nullable: false })
  assertForeignKey("public.color_scheme_preferences", "user_id", idSets.appUsers, { nullable: true })
  assertForeignKey("public.ai_paste_preferences", "user_id", idSets.appUsers, { nullable: false })
  assertForeignKey("public.ask_library_threads", "user_id", idSets.appUsers, { nullable: false })
  assertForeignKey("public.ask_library_threads", "workspace_id", idSets.workspaces, { nullable: true })
  assertForeignKey("public.resource_audit_logs", "resource_id", idSets.resources, { nullable: false })
  assertForeignKey("public.resource_audit_logs", "actor_user_id", idSets.appUsers, { nullable: true })

  return issues
}

async function ensureTargetTablesExist(sqlTarget) {
  for (const qualifiedTable of TABLE_ORDER) {
    const { schema, table } = parseQualifiedTable(qualifiedTable)
    const columns = await getTableColumns(sqlTarget, schema, table)
    if (columns.length === 0) {
      throw new Error(`Target table not found: ${qualifiedTable}`)
    }
  }
}

async function restoreSnapshot(snapshot, options) {
  const targetUrl =
    options.targetUrl ||
    process.env.BACKUP_RESTORE_TARGET_URL?.trim() ||
    null

  if (!targetUrl) {
    throw new Error("Target restore URL missing. Set BACKUP_RESTORE_TARGET_URL or pass --target-url.")
  }

  if (options.confirm !== "RESTORE_DATA") {
    throw new Error("Restore requires explicit confirmation: --confirm RESTORE_DATA")
  }

  if (!options.allowSourceDb && targetUrl === sourceUrl) {
    throw new Error(
      "Refusing to restore into the source database. Pass --allow-source-db only for controlled non-production drills.",
    )
  }

  const sqlTarget = neon(targetUrl)
  await ensureTargetTablesExist(sqlTarget)

  if (options.dryRun) {
    console.log("Dry run complete. Target schema is reachable and compatible.")
    return
  }

  const truncateList = TABLE_ORDER
    .slice()
    .reverse()
    .map((qualifiedTable) => {
      const { schema, table } = parseQualifiedTable(qualifiedTable)
      return qualifiedIdent(schema, table)
    })
    .join(", ")

  await sqlTarget.query("BEGIN")
  try {
    await sqlTarget.query(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`)

    for (const qualifiedTable of TABLE_ORDER) {
      const tablePayload = snapshot.tables[qualifiedTable]
      const rows = tablePayload?.rows ?? []
      if (rows.length === 0) {
        continue
      }

      const { schema, table } = parseQualifiedTable(qualifiedTable)
      const qualified = qualifiedIdent(schema, table)
      const rowsJson = JSON.stringify(rows)

      await sqlTarget.query(
        `INSERT INTO ${qualified} SELECT * FROM json_populate_recordset(NULL::${qualified}, $1::json)`,
        [rowsJson],
      )
    }

    await sqlTarget.query("COMMIT")
  } catch (error) {
    await sqlTarget.query("ROLLBACK")
    throw error
  }

  console.log("Restore completed successfully.")
}

async function runBackup(outputPath) {
  const sql = neon(sourceUrl)
  const snapshot = await createBackupSnapshot(sql)

  const defaultPath = join(root, "backups", `db-backup-${timestampSuffix()}.json`)
  const finalOutputPath = outputPath ? join(root, outputPath) : defaultPath

  mkdirSync(dirname(finalOutputPath), { recursive: true })
  writeFileSync(finalOutputPath, JSON.stringify(snapshot, null, 2), "utf8")

  console.log(`Backup written to ${finalOutputPath}`)
  for (const row of snapshot.summary) {
    console.log(`- ${row.table}: ${row.rowCount} rows`)
  }

  return { snapshot, outputPath: finalOutputPath }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))

  if (command === "backup") {
    await runBackup(options.output)
    return
  }

  if (command === "verify") {
    if (!options.input) {
      throw new Error("verify requires --input <backup-file>")
    }

    const snapshot = loadSnapshot(join(root, options.input))
    const issues = validateSnapshot(snapshot)
    if (issues.length > 0) {
      console.error("Backup verification failed:")
      for (const issue of issues) {
        console.error(`- ${issue}`)
      }
      process.exit(1)
    }

    console.log("Backup verification passed.")
    return
  }

  if (command === "restore") {
    if (!options.input) {
      throw new Error("restore requires --input <backup-file>")
    }

    const snapshot = loadSnapshot(join(root, options.input))
    const issues = validateSnapshot(snapshot)
    if (issues.length > 0) {
      throw new Error(`Backup file failed validation with ${issues.length} issue(s).`)
    }

    await restoreSnapshot(snapshot, options)
    return
  }

  if (command === "drill") {
    const { snapshot, outputPath } = await runBackup(options.output)
    const issues = validateSnapshot(snapshot)
    if (issues.length > 0) {
      console.error("Backup drill failed verification:")
      for (const issue of issues) {
        console.error(`- ${issue}`)
      }
      process.exit(1)
    }

    console.log("Backup drill verification passed.")
    console.log(`Artifact: ${outputPath}`)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
