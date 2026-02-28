# Backup/Restore Drill Report

Date: 2026-02-28
Environment: local development (`.env` + `.env.local`)
Command: `pnpm db:backup:drill`

## Result

- Status: Passed
- Backup artifact created: `backups/db-backup-20260228T114959Z.json`
- Integrity verification: Passed

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

## Notes

- This drill validates logical backup generation and FK-style integrity checks.
- A full destructive restore should still be executed against a disposable target DB before checking off the launch gate item.
