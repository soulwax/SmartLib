# Role Boundary Verification Matrix

Date: 2026-02-28
Owner: Engineering

## Purpose

Prevent accidental privilege regressions for critical API routes by keeping role requirements explicit and machine-checked.

## Role Model

- `viewer`: read-only access to personal/public data; cannot create resources.
- `editor`: can create resources and manage owned resources.
- `admin`: elevated access for admin routes and organization/category management.
- `first_admin`: highest privilege; can promote admins and retains all admin powers.

## High-Risk Route Boundaries

- `POST /api/auth/admins`: `first_admin` only.
- `GET /api/admin/resources`: `admin|first_admin` only.
- `POST /api/admin/resources/[id]/restore`: `admin|first_admin` only.
- `GET /api/admin/audit`: `admin|first_admin` only.
- `POST /api/organizations`: `admin|first_admin` only.
- `POST /api/categories`: `admin|first_admin` only.
- `DELETE /api/categories/[id]`: `admin|first_admin` only.
- `PATCH /api/categories/[id]`: owner OR `admin|first_admin`.
- `PUT/DELETE /api/resources/[id]`: owner OR `admin|first_admin`.
- `POST /api/items/move`: owner OR `admin|first_admin`.
- `POST /api/resources`: blocked for `viewer`.
- `DELETE /api/account/delete`: cannot delete `first_admin` account.

## Automated Verification

Run:

```bash
pnpm verify:role-boundaries
```

What it checks:

- All mutating routes keep CSRF + rate-limit guards.
- Admin routes keep explicit admin guards.
- Resource/item mutation routes keep owner-or-admin checks.
- First-admin invariants remain enforced in auth service.
- Core authorization helper invariants remain unchanged.

Script:

- `scripts/verify-role-boundaries.mjs`

## Release Gate Usage

- Run in pre-release checks.
- Run after any auth, route guard, or permission-related refactor.
- Treat failures as blocking until resolved or policy is intentionally changed and updated here.
