# Focused Security Review: Auth, Permissions, Input Validation

Date: 2026-02-28
Scope: `app/api/**`, `auth.ts`, `lib/auth-service.ts`, `lib/resource-service.ts`

## Method

- Reviewed all state-changing API routes for CSRF protection.
- Reviewed rate-limiting coverage on auth, AI, and write endpoints.
- Reviewed auth/session lifecycle for stale-privilege or deleted-user access.
- Spot-checked role enforcement boundaries (admin/first_admin/editor/viewer).
- Spot-checked payload validation and unsafe JSON parsing behavior.

## Findings

### 1) Stale JWT identity could survive backing-user deletion (High)

Status: Fixed
Files: `auth.ts`

Issue:
- JWT refresh logic refreshed role/admin flags every TTL window, but when `findAuthUserById` returned null, prior token identity fields were left intact.
- Session callback also fell back to `token.sub`, which could preserve user identity after user removal.

Risk:
- Deleted users could continue to authenticate for longer than intended.

Fix:
- Explicitly clear identity/auth fields in JWT callback when backing user is missing.
- Removed `token.sub` fallback in session identity assignment by requiring a non-empty `token.userId`.

### 2) Cron secret compare used direct string equality (Low)

Status: Fixed
Files: `app/api/cron/favicon-refresh/route.ts`

Issue:
- Authorization used plain `===` string comparison for bearer secret.

Risk:
- Not a common practical exploit here, but timing-safe compare is preferred for secret comparisons.

Fix:
- Switched to `crypto.timingSafeEqual` with length check.

## Coverage Summary

- CSRF: State-changing routes reviewed; CSRF validation is consistently applied.
- Rate limits: Auth, AI, and write endpoints have rule coverage in place.
- Permissions: Admin and FirstAdmin gates are present in privileged routes.
- Input validation: Most write endpoints enforce Zod schemas; some handlers still return generic 500 on malformed JSON and should be normalized under the API error standardization task.

## Residual Risk / Follow-up

- JWT auth-state refresh is time-windowed for DB load control; role/deletion changes propagate on refresh cadence rather than strict per-request DB checks.
- Next priority is the existing P0 item: standardize typed API error responses for malformed JSON and validation errors across all routes.
