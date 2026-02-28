# TODO: Public MVP Launch Plan

Goal: ship a stable, secure, presentable public MVP of BlueSix for real users.

## MVP Scope (What "Public MVP" Includes)

- [x] Authentication (email/password) with verification, login, logout (reviewed and hardened on 2026-02-28)
- [ ] Organization > workspace > category > resource flows
- [ ] CRUD for resources, categories, workspaces, organizations (role-restricted)
- [ ] Search, pagination/load-more, and responsive desktop/mobile usage
- [ ] Basic branding (logo, favicon, app metadata) and polished onboarding states

## P0: Must Complete Before Public Launch

### Security & Trust

- [x] Roll out CSRF protection to all state-changing API routes (completed 2026-02-28)
- [x] Add endpoint-level rate limiting (auth, AI, write APIs) with Redis-first limiter and in-memory fallback (completed 2026-02-28)
- [x] Enforce production-safe session/auth configuration and rotation rules (completed 2026-02-28)
- [x] Add password reset flow and account recovery UX (completed 2026-02-28; `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/reset-password`)
- [x] Add account deletion with data export confirmation (completed 2026-02-28; `/api/account/export`, `/api/account/delete`, Preferences > Account)
- [x] Publish Privacy Policy and Terms of Service (completed 2026-02-28; `/privacy`, `/terms`)
- [x] Run a focused security review of auth, permissions, and input validation (completed 2026-02-28; `docs/security-review-auth-permissions-input-validation-2026-02-28.md`)

### Product Reliability

- [x] Fix migration workflow so deploys do not require manual patching (completed 2026-02-28; `scripts/reconcile-legacy-migrations.mjs`, `db:migrate` pre-reconcile)
- [x] Add robust error handling and typed error responses on all API routes (completed 2026-02-28; `lib/api-error.ts`, standardized `{ ok: false, error, code, details? }`)
- [ ] Complete loading/empty/error UI states for all async flows
- [x] Verify role boundaries (viewer/editor/admin/first_admin) end-to-end (completed 2026-02-28; `docs/role-boundary-verification-matrix.md`, `scripts/verify-role-boundaries.mjs`, `pnpm verify:role-boundaries`)
- [ ] Add backup and restore procedure (documented and test-run; runbook + logical backup drill completed 2026-02-28 in `docs/backup-restore-runbook.md` and `docs/backup-restore-drill-2026-02-28.md`, full disposable-target restore run still pending)
- [x] Add smoke test checklist for production release verification (completed 2026-02-28; `docs/production-smoke-test-checklist.md`)

### UX & Presentation

- [ ] Complete mobile responsiveness audit and fix overflow/layout edge cases
- [ ] Accessibility pass (keyboard navigation, focus order, contrast, labels)
- [ ] Add first-run onboarding ("create org/workspace/resource" happy path)
- [ ] Improve no-data and error-copy messaging for public-facing clarity
- [ ] Validate browser support (Chrome, Firefox, Safari, Edge latest)

### Ops & Delivery

- [ ] Add error monitoring (Sentry or equivalent) and alert routing
- [x] Add uptime/health checks and basic incident playbook (completed 2026-02-28; `/api/health/live`, `/api/health/ready`, `docs/incident-playbook.md`)
- [ ] Establish staging environment parity with production config
- [x] Add CI checks for typecheck/build/test before deploy (completed 2026-02-28; `.github/workflows/ci.yml`)

## P1: Should Complete Soon After Launch

- [ ] Bulk operations (batch move/delete/tag)
- [ ] Import/export (JSON, CSV, browser bookmarks)
- [ ] Advanced filtering/sorting
- [ ] Usage analytics (privacy-friendly)
- [ ] Public marketing page + product screenshots/demo
- [ ] Expanded docs (user guide + admin runbook)

## P2: "No Company Says No" Feature Set

### Enterprise Security & Compliance

- [ ] SSO (SAML/OIDC) with SCIM provisioning/deprovisioning
- [ ] Granular RBAC with custom roles and policy templates
- [ ] Immutable audit logs with export and retention controls
- [ ] IP allowlists and session/device management controls
- [ ] Compliance pack: SOC 2 readiness checklist, DPA template, data residency options

### Platform & Integrations

- [ ] Public API with scoped service tokens and usage quotas
- [ ] Webhooks for resource/category/workspace lifecycle events
- [ ] Native Slack + Microsoft Teams integrations (link push, digest, alerts)
- [ ] Google Drive/Notion/Confluence import connectors
- [ ] Zapier/Make integration templates and quick-start recipes

### Collaboration & Workflow

- [ ] Real-time collaborative editing/presence for shared workspaces
- [ ] Comment threads, mentions, and approval workflows on resources
- [ ] Saved views and shared filters per team/workspace
- [ ] Scheduled digests (daily/weekly) with team-specific highlights
- [ ] Workspace templates and one-click onboarding kits by use case

### Intelligence & Automation

- [ ] AI-powered auto-tagging/categorization with confidence + human override
- [ ] Duplicate detection with merge suggestions across organizations
- [ ] Semantic search + "ask across company knowledge" with citations
- [ ] Rules engine ("if URL contains X, tag Y and route to workspace Z")
- [ ] Agentic inbox triage mode for large-batch processing

### Revenue & GTM Levers

- [ ] Self-serve billing (Stripe), seat management, and usage-based add-ons
- [ ] Admin analytics dashboard: adoption, active teams, ROI signals
- [ ] White-label branding (logo/colors/custom domain) for enterprise plans
- [ ] In-product referrals/invitations with viral sharing loops
- [ ] Public status page and trust center for sales/enterprise procurement

## Current Known Issues / Risks

- [ ] Migration tracking still has manual-recovery paths in some environments
- [ ] Redis-backed rate limit fallback currently degrades to per-instance in-memory limits when `REDIS_URL` is unavailable
- [ ] Scroll-position persistence currently prioritizes desktop main board flow
- [ ] Browser favicon cache may delay visual favicon updates after deployment
- [ ] AI-assisted categorization quality needs broader real-world validation

## Launch Readiness Gate (Definition of Done)

- [ ] All P0 items complete
- [ ] Critical/high vulnerabilities remediated
- [ ] End-to-end smoke test passes in production-like env
- [ ] Error tracking + alerts verified by test incident
- [ ] Documentation published (privacy, terms, support contact)
- [ ] Rollback plan documented and rehearsed once

## Success Metrics (First 30 Days)

- [ ] Uptime >= 99.9%
- [ ] p95 page load < 2.5s
- [ ] p95 API latency < 500ms for core read endpoints
- [ ] < 1% error rate on core user actions
- [ ] Activation: users who create first workspace/resource
- [ ] 7-day retention tracked and reviewed weekly

---

Last Updated: 2026-02-28
Target MVP Launch: TBD
