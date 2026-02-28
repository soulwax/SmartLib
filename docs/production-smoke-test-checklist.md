# Production Smoke Test Checklist

Use this checklist after each production deploy and before announcing release completion.

## 1) Platform Baseline

- [ ] `GET /api/health/live` returns `200` and status `ok`
- [ ] `GET /api/health/ready` returns `200` (or expected `degraded` with documented reason)
- [ ] No active deployment errors in hosting logs
- [ ] No new high-severity alerts in monitoring

## 2) Authentication

- [ ] Register a new user (email/password) from public UI
- [ ] Verify email link flow succeeds
- [ ] Login with verified credentials succeeds
- [ ] Invalid credentials show non-sensitive failure message
- [ ] Sign out completes and protected operations fail afterward

## 3) Authorization & Roles

- [ ] Viewer cannot access write/admin endpoints
- [ ] Editor can create/update resources but cannot perform admin-only actions
- [ ] Admin can perform allowed org/workspace/category management actions
- [ ] FirstAdmin-only paths are restricted correctly

## 4) Core Product Flows

- [ ] Create organization (if admin), workspace, category, and resource
- [ ] Move a resource between categories
- [ ] Edit and delete resource; restore if archive flow exists
- [ ] Search and pagination/load-more work for populated data
- [ ] Organization/workspace selection persistence restores correctly

## 5) AI Flows (If Enabled)

- [ ] Suggest from URL endpoint succeeds for authenticated user
- [ ] Batch suggestion and summarize endpoints return valid payloads
- [ ] Ask Library endpoint returns answer + citations
- [ ] AI-disabled/fallback mode returns graceful deterministic responses

## 6) Security Controls

- [ ] CSRF protections reject cross-origin mutation requests
- [ ] Rate limits return `429` with retry headers when exceeded
- [ ] Sensitive error details are not exposed in API responses

## 7) UX & Rendering

- [ ] Home page loads on desktop and mobile breakpoints
- [ ] Header logo/favicon render correctly
- [ ] Empty/loading/error states display correctly across key screens
- [ ] Browser back/forward preserves expected navigation state

## 8) Data Integrity

- [ ] New records appear in database as expected
- [ ] No duplicate categories/workspaces from normal create flow
- [ ] Soft-delete and restore lifecycle remains consistent

## 9) Rollback Readiness

- [ ] Previous stable release identifier is documented
- [ ] Rollback steps are ready and tested in staging
- [ ] Team knows owner for rollback execution

## Sign-Off

- [ ] Product owner sign-off
- [ ] Engineering sign-off
- [ ] Incident channel prepared for first 60 minutes post-release monitoring
