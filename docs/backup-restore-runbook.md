# Backup & Restore Runbook (Logical JSON)

Date: 2026-02-28
Owner: Engineering

## Purpose

Provide a repeatable, scriptable backup and restore process that does not depend on local `pg_dump` tooling.

## Scripts

- Backup: `pnpm db:backup`
- Backup drill (backup + integrity verification): `pnpm db:backup:drill`
- Verify existing backup artifact: `pnpm db:backup:verify -- --input <path>`
- Restore (destructive on target): `pnpm db:restore -- --input <path> --confirm RESTORE_DATA --target-url <postgres-url>`

Implementation:

- `scripts/db-backup-restore.mjs`

## Artifact Format

- JSON snapshot of all core application tables in deterministic restore order.
- Includes per-table column metadata, primary key columns, and row payloads.
- Includes FK-style integrity checks during verification.

## Standard Drill Procedure

1. Run a non-destructive drill:

```bash
pnpm db:backup:drill
```

2. Confirm output includes:
- Backup artifact path
- Per-table row counts
- `Backup drill verification passed`

3. Record artifact location and command output in release notes or incident ticket.

## Restore Procedure (Disposable Target Recommended)

1. Provision empty/disposable target DB with current schema/migrations applied.
2. Run restore with explicit confirmation token:

```bash
pnpm db:restore -- --input <path> --target-url <target-db-url> --confirm RESTORE_DATA
```

3. Validate core checks on target DB:
- Login works
- Resource listing works
- Category/workspace counts match source snapshot

## Safety Controls

- Restore requires explicit `--confirm RESTORE_DATA`.
- Restore refuses to target the source DB unless `--allow-source-db` is explicitly set.
- Recommended practice: only restore into disposable targets for drills.

## Limitations

- This is logical backup/restore (JSON), not physical WAL/PITR.
- Large datasets may produce large JSON artifacts.
- For enterprise-grade RPO/RTO, complement with provider-native snapshots/PITR.
