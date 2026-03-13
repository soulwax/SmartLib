import { spawnSync } from "node:child_process"

function isTruthy(value) {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  })

  if (result.error) {
    throw result.error
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status)
  }
}

const isVercel = process.env.VERCEL === "1"
const skipDbMigrate = isTruthy(process.env.VERCEL_SKIP_DB_MIGRATE)
const hasUnpooledDatabaseUrl = Boolean(process.env.DATABASE_URL_UNPOOLED?.trim())

if (!isVercel) {
  console.log("[vercel:build] Non-Vercel environment detected. Running app build only.")
} else if (skipDbMigrate) {
  console.log("[vercel:build] Skipping database migrations because VERCEL_SKIP_DB_MIGRATE is enabled.")
} else if (!hasUnpooledDatabaseUrl) {
  console.log("[vercel:build] DATABASE_URL_UNPOOLED is not set. Skipping deploy-time migrations.")
} else {
  console.log("[vercel:build] Running database migrations before build.")
  run("pnpm", ["db:migrate"])
}

console.log("[vercel:build] Running Next.js build.")
run("pnpm", ["build"])
