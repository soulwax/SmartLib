# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Display user role label alongside email in the header
- Resource metadata fields: AI-enriched title, description, and categorisation
- Resource tags: tagging system with many-to-many relationship
- Resource categories table with symbol/icon support and dynamic suggestions in the add-resource modal
- Color scheme preferences table and user-scoped repository
- New dark color schemes: Gruvbox Dark, Monokai, Tokyo Night, Kanagawa Wave, Palenight, Rosé Pine Moon, Synthwave '84, Everforest Dark
- New light color schemes: GitHub Light, One Light, Solarized Light, and more
- Email verification: token table, generation, and resend functionality
- Audit logging for resource restore and delete actions
- Soft-delete for resources with restore support
- Admin promotion and user role management
- Email/password authentication via NextAuth

### Changed

- Project renamed from DevVault to Knowledge
- Header now shows logged-in user's email and total resource counts
- Resource management refactored with a service layer; mock data support for local development
- Code style: standardised semicolons across `db.ts` and `resource-repository.ts`

### Fixed

- `extractJsonCandidate`: removed incorrect `errorResponse` return that caused a TypeScript type error (`NextResponse` not assignable to `string`)
- Import path for route type definitions in `next-env.d.ts`
- `onlyBuiltDependencies` configuration added for `sharp` in `package.json`

## [0.1.2] - 2026-02-17

### Changed

- Categories left side panel now supports mouse-drag resizing on desktop layouts
- Added resize width clamping for the Categories panel to keep it within usable min/max bounds

## [0.1.1] - 2026-02-17

### Changed

- Main content links now render as compact item cards for denser scanning
- Added favicon display to the left of each link title, with graceful icon fallback when unavailable

## [0.1.0] - 2026-02-11

### Added

- Initial commit — scaffolded from v0 with base Next.js 16 + Turbopack setup, Drizzle ORM, Neon serverless Postgres, and Radix UI component library
