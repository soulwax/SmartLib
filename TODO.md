# TODO: Public MVP Launch Plan

Goal: ship a stable, secure, presentable public MVP of BlueSix for real users.

## MVP Scope (What "Public MVP" Includes)

- [ ] Authentication (email/password) with verification, login, logout
- [ ] Organization > workspace > category > resource flows
- [ ] CRUD for resources, categories, workspaces, organizations (role-restricted)
- [ ] Search, pagination/load-more, and responsive desktop/mobile usage
- [ ] Basic branding (logo, favicon, app metadata) and polished onboarding states

## P0: Must Complete Before Public Launch

### Security & Trust

- [ ] Roll out CSRF protection to all state-changing API routes
- [ ] Add endpoint-level rate limiting (auth, AI, write APIs)
- [ ] Enforce production-safe session/auth configuration and rotation rules
- [ ] Add password reset flow and account recovery UX
- [ ] Add account deletion with data export confirmation
- [ ] Publish Privacy Policy and Terms of Service
- [ ] Run a focused security review of auth, permissions, and input validation

### Product Reliability

- [ ] Fix migration workflow so deploys do not require manual patching
- [ ] Add robust error handling and typed error responses on all API routes
- [ ] Complete loading/empty/error UI states for all async flows
- [ ] Verify role boundaries (viewer/editor/admin/first_admin) end-to-end
- [ ] Add backup and restore procedure (documented and test-run)
- [ ] Add smoke test checklist for production release verification

### UX & Presentation

- [ ] Complete mobile responsiveness audit and fix overflow/layout edge cases
- [ ] Accessibility pass (keyboard navigation, focus order, contrast, labels)
- [ ] Add first-run onboarding ("create org/workspace/resource" happy path)
- [ ] Improve no-data and error-copy messaging for public-facing clarity
- [ ] Validate browser support (Chrome, Firefox, Safari, Edge latest)

### Ops & Delivery

- [ ] Add error monitoring (Sentry or equivalent) and alert routing
- [ ] Add uptime/health checks and basic incident playbook
- [ ] Establish staging environment parity with production config
- [ ] Add CI checks for typecheck/build/test before deploy

## P1: Should Complete Soon After Launch

- [ ] Bulk operations (batch move/delete/tag)
- [ ] Import/export (JSON, CSV, browser bookmarks)
- [ ] Advanced filtering/sorting
- [ ] Usage analytics (privacy-friendly)
- [ ] Public marketing page + product screenshots/demo
- [ ] Expanded docs (user guide + admin runbook)

## Current Known Issues / Risks

- [ ] Migration tracking still has manual-recovery paths in some environments
- [ ] CSRF is not yet consistently enforced on every write endpoint
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
