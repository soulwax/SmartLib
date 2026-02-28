#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8")
}

function includesAll(content, patterns) {
  return patterns.filter((pattern) => !pattern.regex.test(content))
}

const findings = []

function assertPatterns(relativePath, description, patterns) {
  const content = read(relativePath)
  const missing = includesAll(content, patterns)
  if (missing.length === 0) {
    return
  }

  findings.push({
    file: relativePath,
    description,
    missing: missing.map((item) => item.label),
  })
}

const mutatingRoutes = [
  "app/api/account/delete/route.ts",
  "app/api/admin/resources/[id]/restore/route.ts",
  "app/api/auth/admins/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/request-password-reset/route.ts",
  "app/api/auth/resend-verification/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/categories/[id]/route.ts",
  "app/api/categories/[id]/suggest-name/route.ts",
  "app/api/categories/route.ts",
  "app/api/items/move/route.ts",
  "app/api/library/ask/route.ts",
  "app/api/links/suggest-batch/route.ts",
  "app/api/links/suggest-category-name/route.ts",
  "app/api/links/suggest-from-url/route.ts",
  "app/api/links/summarize-batch/route.ts",
  "app/api/organizations/route.ts",
  "app/api/preferences/ai-paste/route.ts",
  "app/api/preferences/color-scheme/route.ts",
  "app/api/resources/[id]/route.ts",
  "app/api/resources/route.ts",
  "app/api/workspaces/[id]/route.ts",
  "app/api/workspaces/route.ts",
]

for (const route of mutatingRoutes) {
  assertPatterns(route, "mutating route hardening", [
    { label: "CSRF validation", regex: /validateCSRF\(/ },
    { label: "rate limit assertion", regex: /assertRequestRateLimit\(/ },
  ])
}

const roleBoundaryChecks = [
  {
    file: "app/api/admin/resources/route.ts",
    description: "admin resource listing requires admin role",
    patterns: [{ label: "admin guard", regex: /if \(!session\.user\.isAdmin\)/ }],
  },
  {
    file: "app/api/admin/resources/[id]/restore/route.ts",
    description: "resource restore requires admin role",
    patterns: [{ label: "admin guard", regex: /if \(!session\.user\.isAdmin\)/ }],
  },
  {
    file: "app/api/admin/audit/route.ts",
    description: "audit access requires admin role",
    patterns: [{ label: "admin guard", regex: /if \(!session\.user\.isAdmin\)/ }],
  },
  {
    file: "app/api/auth/admins/route.ts",
    description: "admin promotion remains first-admin-only",
    patterns: [
      { label: "NotFirstAdminError handling", regex: /NotFirstAdminError/ },
      { label: "promotion service call", regex: /promoteAuthUserToAdmin\(/ },
    ],
  },
  {
    file: "lib/auth-service.ts",
    description: "first-admin invariant checks in auth service",
    patterns: [
      { label: "promote guard", regex: /if \(!actingUser\.isFirstAdmin\)\s*\{\s*throw new NotFirstAdminError\(\)/ },
      { label: "delete guard", regex: /if \(user\.isFirstAdmin\)\s*\{\s*throw new CannotDeleteFirstAdminError\(\)/ },
    ],
  },
  {
    file: "app/api/resources/route.ts",
    description: "resource creation blocks viewer role",
    patterns: [{ label: "canCreateResources check", regex: /if \(!canCreateResources\(role\)\)/ }],
  },
  {
    file: "app/api/resources/[id]/route.ts",
    description: "resource edit/delete require owner or admin",
    patterns: [{ label: "canManageResource check", regex: /if \(!canManageResource\(role, session\.user\.id, existing\.ownerUserId\)\)/ }],
  },
  {
    file: "app/api/items/move/route.ts",
    description: "move operation requires owner or admin",
    patterns: [{ label: "canManageResource check", regex: /if \(!canManageResource\(role, session\.user\.id, existing\.ownerUserId\)\)/ }],
  },
  {
    file: "app/api/organizations/route.ts",
    description: "organization creation requires admin access",
    patterns: [{ label: "hasAdminAccess check", regex: /if \(!hasAdminAccess\(role\)\)/ }],
  },
  {
    file: "app/api/categories/route.ts",
    description: "category creation requires admin",
    patterns: [{ label: "admin guard", regex: /if \(!session\.user\.isAdmin\)/ }],
  },
  {
    file: "app/api/categories/[id]/route.ts",
    description: "category deletion requires admin; patch allows owner/admin",
    patterns: [
      { label: "admin delete guard", regex: /if \(!session\.user\.isAdmin\)/ },
      { label: "owner-or-admin patch guard", regex: /!session\.user\.isAdmin\s*&&/ },
    ],
  },
  {
    file: "app/api/categories/[id]/suggest-name/route.ts",
    description: "category suggest-name requires owner/admin",
    patterns: [{ label: "owner-or-admin guard", regex: /if \(!session\.user\.isAdmin && !isOwner\)/ }],
  },
  {
    file: "lib/authorization.ts",
    description: "authorization role model invariants",
    patterns: [
      { label: "defined roles include first_admin", regex: /"first_admin"/ },
      { label: "admin access helper", regex: /return role === "admin" \|\| role === "first_admin"/ },
      { label: "viewer cannot create resources", regex: /return role !== "viewer"/ },
      { label: "edit requires owner match", regex: /return actorUserId === ownerUserId/ },
    ],
  },
]

for (const check of roleBoundaryChecks) {
  assertPatterns(check.file, check.description, check.patterns)
}

if (findings.length > 0) {
  console.error("Role boundary verification failed.\n")
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.description}`)
    for (const missing of finding.missing) {
      console.error(`  missing: ${missing}`)
    }
  }
  process.exit(1)
}

const totalChecks =
  mutatingRoutes.length * 2 +
  roleBoundaryChecks.reduce((sum, item) => sum + item.patterns.length, 0)

console.log(`Role boundary verification passed (${totalChecks} checks).`)
