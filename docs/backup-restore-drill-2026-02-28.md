# Backup/Restore Drill Report

Date: 2026-02-28
Environment: local development (`.env` + `.env.local`)
Command: `pnpm db:backup:drill`

## Result

- Status: Passed
- Backup artifact created: `backups/db-backup-20260228T114959Z.json`
- Integrity verification: Passed
- Disposable-target restore execution: Passed
- Target environment: Neon branch `ep-wispy-cherry-agxgbz22` (pooler + unpooled URLs)

## Row Count Snapshot

- `public.app_users`: 11
- `public.resource_organizations`: 1
- `public.resource_workspaces`: 2
- `public.resource_categories`: 34
- `public.resource_tags`: 33
- `public.resource_cards`: 40
- `public.resource_links`: 192
- `public.resource_card_tags`: 19
- `public.email_verification_tokens`: 5
- `public.password_reset_tokens`: 0
- `public.color_scheme_preferences`: 7
- `public.ai_paste_preferences`: 1
- `public.ask_library_threads`: 0
- `public.resource_audit_logs`: 2
- `public.favicon_cache`: 160

## Restore Execution

1. Schema bootstrap on disposable target was run with `drizzle-kit push --force` (target DB env override).
2. Full restore was run with `pnpm db:restore -- --input backups/db-backup-20260228T114959Z.json --confirm RESTORE_DATA`.
3. Post-restore validation compared live row counts for all backed-up tables against backup `summary`; all tables matched exactly.

## Notes

- This drill validates logical backup generation, FK-style integrity checks, and full destructive restore on a disposable target DB.
- `drizzle-kit migrate` on a blank target currently encounters legacy migration ordering drift; for disposable restore targets we used schema bootstrap via `drizzle-kit push --force` before restore.
