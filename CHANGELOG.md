# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.2.4] - 2026-02-22

### Added

- New `GET /api/workspaces/counts` endpoint for lightweight per-workspace resource totals used by the workspace rail
- New top-level `Organization` hierarchy (`Organization -> Workspace -> Category -> Item`) with default `Public` organization seeding
- New `GET/POST /api/organizations` endpoint for listing organizations and creating them (admin-only create)
- New organization rail (Discord-style vertical rounded-square navigation) above workspace rail in desktop and mobile navigation

### Changed

- Resource bootstrap now loads workspace-scoped pages (`limit` + `nextOffset`) instead of pulling all workspaces' cards at once
- `GET /api/resources` now supports workspace filtering and optional pagination (`workspaceId`, `offset`, `limit`)
- Library board now supports incremental loading with `Load more resources` for large workspaces
- Bootstrap/workspace APIs now support organization-scoped selection (`organizationId`) and resolve active organization/workspace together

## [0.2.3] - 2026-02-21

### Added

- New `GET /api/library/bootstrap` snapshot endpoint so resources, categories, and workspaces can be loaded in a single request
- New `Really Compact` mode with runtime toggle, URL sync (`?compact=true`), and persisted local preference
- Compact top-bar action cluster with icon-first controls for search focus, AI actions (`⚡`), quick add, settings, and mode toggling
- Ultra-dense compact board mode with collapsed category rows, inline link chips, hover detail flyouts, and virtualized rendering via `react-window`

### Changed

- Page bootstrap and manual refresh now use the snapshot endpoint and wait for auth session hydration to avoid duplicate initial fetches
- Desktop navigation now supports compact density behavior (narrower workspace rail and compact-mode category navigation flow)
- Added compact density CSS variables and root compact-mode selectors for consistent spacing/row-height control

## [0.2.2] - 2026-02-18

### Added

- AI Inbox quick actions for Toby-style workflows: `Group`, `Short names`, `Sort`, `Dedupe`, and `Summary`
- New `POST /api/links/suggest-category-name` endpoint for short category naming from analyzed link clusters (AI + deterministic fallback)
- New `POST /api/links/summarize-batch` endpoint for batch triage summaries with focus categories and recommended next actions
- New reusable `PaletteDropdown` component with grouped light/dark theme lists and live swatch previews

### Changed

- AI Inbox modal now uses unified busy-state locking across analyze/import/merge/rename/summary operations
- AI Inbox summary panel now displays model metadata (`AI` vs fallback), focus categories, and actionable follow-up steps
- Replaced slider-based theme selection in page settings with dropdown selectors that show the active scheme label and description
- Theme selection now commits directly through dropdown actions while preserving persisted preference sync feedback

## [0.2.1] - 2026-02-18

### Added

- New `AI Inbox` workflow for batch URL triage: paste up to 25 URLs, run AI/fallback enrichment, review inline metadata, and import selected links to the active workspace
- New batch suggestion endpoint `POST /api/links/suggest-batch` with duplicate insight payload per analyzed URL
- Shared link duplicate analysis utility for exact and near-duplicate detection based on canonical URL and similarity heuristics
- URL extraction helper for bulk paste input parsing (`extractHttpUrlsFromText`)
- New AI Inbox `Smart merge` action for exact duplicates: merges selected items into existing cards by enriching tags and appending non-duplicate note context
- Shared link-item drag payload format for drag-and-drop between the main board and sidebar category targets
- Sidebar category drop targets (desktop and mobile) for moving dragged link items directly into categories

### Changed

- Drag interaction now starts from individual link rows instead of entire resource cards
- Category move flow now accepts link-initiated drops from both board and sidebar targets while preserving optimistic update and rollback behavior
- Paste-to-modal flow now warns when the pasted URL already exists (or is very similar) in the current workspace
- Resource save flow now prompts for confirmation when exact/similar duplicates are detected before creating/updating a card

## [0.2.0] - 2026-02-18

### Added

- Ask Library multi-turn conversation support in the dialog, with follow-up questions using recent thread context
- Ask Library explanation metadata (`Why this answer`) including matched keywords, primary categories, and confidence level
- Ask Library thread persistence (database-backed) per user/workspace, including new thread listing/detail APIs
- Ask Library follow-up suggestion generation and one-click follow-up actions in the answer panel
- New migration `0012_noble_molecule` creating `ask_library_threads`
- Draggable category board layout with reusable modular resource cards that can move within and across categories
- New item move API endpoint (`POST /api/items/move`) for explicit move operations (`itemId`, source/target category IDs, and target order)
- Item placement model fields (`categoryId`, `order`) with sparse ordering support for efficient drag-and-drop updates

### Changed

- Ask Library API now accepts bounded conversation history and uses it to improve retrieval relevance for follow-up prompts
- Citation rendering now includes per-source match confidence percentages
- Ask Library request scoping now supports explicit workspace/category/tags toggles for faster refinements
- Resource browsing now renders as category columns and performs optimistic drag-and-drop updates with rollback/error toast on failed move sync
- Move processing now enforces atomic category ownership/order updates and reindexes only affected target-category items when order collisions occur
- Database and mock stores now keep category-to-item linkage consistent via category IDs during create/update/delete/move flows

## [0.1.11] - 2026-02-18

### Added

- Automatic category deduplication/merge workflow for normalized name collisions (case-insensitive + trimmed + collapsed whitespace), applied in both database and mock modes
- Database bootstrap pass that retroactively consolidates existing duplicate category groups across current data

### Changed

- Category create and rename flows now merge into a canonical category instead of returning duplicate-name conflicts
- Resource-category reassignment paths now use normalized category matching so legacy spacing/casing variants are merged safely
- Conflict resolution strategy is now deterministic:
  canonical category is the oldest row; symbol prefers explicit rename input then canonical symbol then first available duplicate symbol; owner prefers canonical owner then first available duplicate owner

### Fixed

- Prevented silent category fragmentation caused by legacy whitespace/casing variants that previously bypassed duplicate checks

## [0.1.10] - 2026-02-18

### Added

- `Ask Your Library` API endpoint (`POST /api/library/ask`) with scoped retrieval and citation output
- New server-side library QA service for ranked matching, citation extraction, and deterministic fallback answers
- `Ask Library` UI flow: header action, context-menu shortcut, and dialog with cited result links

### Changed

- `Ask Library` now uses AI-assisted answering (when enabled and authenticated) with automatic fallback to rule-based summaries
- AI link suggestion pipeline now carries suggested categories and tags into add-resource prefill state and modal initialization

### Fixed

- Library Q&A now remains functional even when AI generation fails, by returning citation-backed deterministic answers instead of hard-failing

## [0.1.9] - 2026-02-18

### Added

- Admin dashboard `User Management` section with an in-panel `Promote to Admin` action for FirstAdmin users
- AI link suggestion responses now include category and tag suggestions, with paste-to-modal prefill support

### Changed

- Removed `Promote Admin` controls from the main library header and quick actions; promotion is now available only in the admin dashboard
- AI link suggestion requests now pass existing category hints to improve categorization relevance
- Added a global activity status pill for long-running UI actions (for example paste processing and library refresh)

### Fixed

- Prevented duplicate clipboard paste actions while a paste flow is already running
- Prevented overlapping library refresh requests from being triggered concurrently

## [0.1.8] - 2026-02-18

### Changed

- Email verification template rewritten: proper `<!DOCTYPE html>` structure, hidden preheader, branded header, CTA button, fallback URL, and footer disclaimer
- Email subject changed from generic `"Confirm your email address"` to `"Confirm your lib.bluesix account"` to reduce spam misclassification
- Plain-text part updated with app name header and clearer copy
- Added `X-Entity-Ref-ID` header per send to prevent Gmail threading repeated verification emails into a single collapsed conversation
- Added Resend `tags` field (`category: email-verification`) for dashboard filtering and per-category tracking control

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

## [0.1.7] - 2026-02-18

### Added

- Category context-menu action `Paste URL into category` in the sidebar (desktop and mobile)
- Global keyboard paste support (`Ctrl+V` / `Cmd+V`) for URL paste-to-modal flow when focus is not inside editable fields
- Optional manual URL prompt fallback when browser clipboard-read permissions block direct clipboard access

### Changed

- Add Resource category field changed from select-only to editable input with suggestions, enabling direct paste/typing
- Paste flow now accepts a target category and pre-fills category when opening from category-scoped paste actions
- Library context-menu paste action is now always shown (when resource creation is allowed) and validates clipboard on selection

### Fixed

- Resolved missing/hidden right-click paste action in category workflows
- Resolved no-op paste behavior in category entry scenarios by enabling editable category input

## [0.1.6] - 2026-02-18

### Added

- Right-click library action `Paste URL from clipboard`, shown only when clipboard currently contains a valid `http(s)` URL
- AI paste suggestion endpoint for URL enrichment (`label` + short `note`) before opening the add-resource modal
- Database-backed AI paste prompt preference (`accepted` / `declined`) with new API routes and repository support

### Changed

- Paste flow now supports one-time `Enable AI for Paste?` choice (`Yes`/`No`) and remembers that choice for signed-in users
- Add resource modal now supports opening with a prefilled initial link draft from clipboard paste actions

### Fixed

- Paste workflow now gracefully falls back to non-AI link metadata when AI is unavailable or suggestion requests fail

## [0.1.5] - 2026-02-18

### Added

- AI-assisted category rename suggestion endpoint that analyzes links in a category and proposes a short fitting name
- `Enable AI features` user preference toggle (off by default; disabled for guest sessions)
- Category settings modal action `Suggest with AI` when user is logged in and AI features are enabled

### Changed

- Category settings now support editing category name and symbol together
- Category update API expanded to accept both `name` and `symbol` updates in a single request
- Category rename flow now propagates renamed category names to matching resource cards in both database and mock modes

### Fixed

- Category rename/save flow now keeps active category and in-memory resources consistent immediately after rename
- Category update API now returns conflict (`409`) for duplicate category names in workspace scope

## [0.1.4] - 2026-02-18

### Added

- Owner-only `Edit Category` action in category context menus, including right-click on category cards when not targeting a specific link item
- Dedicated `Edit Category` customization modal for category settings updates

### Changed

- Replaced prompt-based category symbol editing with modal-based category customization flow
- Header quick action now uses `Edit Category` terminology for active category customization

### Fixed

- Category update permissions now allow authenticated category owners (not only admins) to save category customization

## [0.1.3] - 2026-02-17

### Added

- Workspace settings panel with tabbed controls for Appearance, Layout, and Access
- Smarter section titles with optional context lines, role hints, and compact heading mode
- Admin quick-action controls in section headers for faster moderation workflows

### Changed

- Category sidebar heading now supports metadata, count badges, and optional role-aware hints
- Mobile sheet no longer duplicates the category heading from the sidebar body
- Empty library states now guide authenticated users without a workspace to create one first

### Fixed

- Enforced a hard limit of one personal workspace per signed-in account in both database and mock modes
- Disabled the shared default workspace for authenticated users; signed-in users now only see and use their own workspace
- Workspace creation API now returns a clear conflict response when the workspace limit is reached

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
