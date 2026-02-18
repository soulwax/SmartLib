import "server-only";

import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { getDatabaseEnv } from "@/lib/env";
import * as schema from "@/lib/db-schema";

let sqlClient: NeonQueryFunction<false, false> | null = null;
let dbClient: NeonHttpDatabase<typeof schema> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlClient !== null) {
    return sqlClient;
  }

  const { DATABASE_URL } = getDatabaseEnv();
  sqlClient = neon<false, false>(DATABASE_URL);
  return sqlClient;
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (dbClient !== null) {
    return dbClient;
  }

  dbClient = drizzle(getSql(), { schema });
  return dbClient;
}

export function resetDatabaseClientForTests() {
  sqlClient = null;
  dbClient = null;
  schemaReady = null;
}

export async function ensureSchema() {
  if (schemaReady !== null) {
    await schemaReady;
    return;
  }

  const sql = getSql();

  schemaReady = (async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT NOT NULL CHECK (char_length(category) <= 80),
        owner_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `;

    await sql`
      ALTER TABLE resource_cards
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `;

    await sql`
      ALTER TABLE resource_cards
      ADD COLUMN IF NOT EXISTS owner_user_id UUID
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL CHECK (char_length(name) <= 80),
        symbol TEXT,
        owner_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      ALTER TABLE resource_categories
      ADD COLUMN IF NOT EXISTS symbol TEXT
    `;

    await sql`
      ALTER TABLE resource_categories
      ADD COLUMN IF NOT EXISTS owner_user_id UUID
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_categories_created_at_idx
      ON resource_categories (created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_categories_owner_user_id_idx
      ON resource_categories (owner_user_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL CHECK (char_length(name) <= 40),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS resource_tags_name_lower_idx
      ON resource_tags ((lower(name)))
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_tags_created_at_idx
      ON resource_tags (created_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_card_tags (
        resource_id UUID NOT NULL REFERENCES resource_cards(id) ON DELETE CASCADE,
        tag_id UUID NOT NULL REFERENCES resource_tags(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_card_tags_resource_id_idx
      ON resource_card_tags (resource_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_card_tags_tag_id_idx
      ON resource_card_tags (tag_id)
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS resource_card_tags_resource_tag_unique_idx
      ON resource_card_tags (resource_id, tag_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id UUID NOT NULL REFERENCES resource_cards(id) ON DELETE CASCADE,
        url TEXT NOT NULL CHECK (char_length(url) <= 2048),
        label TEXT NOT NULL CHECK (char_length(label) <= 120),
        note TEXT,
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_cards_created_at_idx
      ON resource_cards (created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_cards_owner_user_id_idx
      ON resource_cards (owner_user_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_links_resource_id_position_idx
      ON resource_links (resource_id, position)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL CHECK (char_length(email) <= 320),
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'editor',
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        is_first_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
    `;

    await sql`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS is_first_admin BOOLEAN NOT NULL DEFAULT FALSE
    `;

    await sql`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'editor'
    `;

    await sql`
      UPDATE app_users
      SET role = CASE
        WHEN is_first_admin = true THEN 'first_admin'
        WHEN is_admin = true THEN 'admin'
        WHEN role IS NULL OR role = '' THEN 'editor'
        ELSE role
      END
      WHERE role IS DISTINCT FROM CASE
        WHEN is_first_admin = true THEN 'first_admin'
        WHEN is_admin = true THEN 'admin'
        WHEN role IS NULL OR role = '' THEN 'editor'
        ELSE role
      END
    `;

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'app_users_role_check'
        ) THEN
          ALTER TABLE app_users
          ADD CONSTRAINT app_users_role_check
          CHECK (role IN ('viewer', 'editor', 'admin', 'first_admin'));
        END IF;
      END $$;
    `;

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'resource_categories_owner_user_id_app_users_id_fk'
        ) THEN
          ALTER TABLE resource_categories
          ADD CONSTRAINT resource_categories_owner_user_id_app_users_id_fk
          FOREIGN KEY (owner_user_id)
          REFERENCES app_users(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    await sql`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ
    `;

    await sql`
      ALTER TABLE app_users
      ALTER COLUMN password_hash DROP NOT NULL
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
      ON app_users ((lower(email)))
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_first_admin_idx
      ON app_users (is_first_admin)
      WHERE is_first_admin = true
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL CHECK (char_length(name) <= 80),
        owner_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS resource_workspaces_owner_name_lower_idx
      ON resource_workspaces (
        (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        (lower(name))
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_workspaces_created_at_idx
      ON resource_workspaces (created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_workspaces_owner_user_id_idx
      ON resource_workspaces (owner_user_id)
    `;

    await sql`
      INSERT INTO resource_workspaces (name, owner_user_id)
      VALUES ('Main Workspace', NULL)
      ON CONFLICT (
        (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        (lower(name))
      ) DO NOTHING
    `;

    await sql`
      ALTER TABLE resource_categories
      ADD COLUMN IF NOT EXISTS workspace_id UUID
    `;

    await sql`
      ALTER TABLE resource_cards
      ADD COLUMN IF NOT EXISTS workspace_id UUID
    `;

    await sql`
      UPDATE resource_categories
      SET workspace_id = main_workspace.id
      FROM (
        SELECT id
        FROM resource_workspaces
        WHERE owner_user_id IS NULL
          AND lower(name) = lower('Main Workspace')
        ORDER BY created_at ASC
        LIMIT 1
      ) AS main_workspace
      WHERE resource_categories.workspace_id IS NULL
    `;

    await sql`
      UPDATE resource_cards AS card
      SET
        workspace_id = COALESCE(
          (
            SELECT assigned.workspace_id
            FROM resource_categories AS assigned
            WHERE lower(assigned.name) = lower(card.category)
            ORDER BY assigned.created_at ASC
            LIMIT 1
          ),
          main_workspace.id
        ),
        updated_at = NOW()
      FROM (
        SELECT id
        FROM resource_workspaces
        WHERE owner_user_id IS NULL
          AND lower(name) = lower('Main Workspace')
        ORDER BY created_at ASC
        LIMIT 1
      ) AS main_workspace
      WHERE card.workspace_id IS NULL
    `;

    await sql`
      ALTER TABLE resource_categories
      ALTER COLUMN workspace_id SET NOT NULL
    `;

    await sql`
      ALTER TABLE resource_cards
      ALTER COLUMN workspace_id SET NOT NULL
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_categories_workspace_id_idx
      ON resource_categories (workspace_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_cards_workspace_id_idx
      ON resource_cards (workspace_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_cards_workspace_id_active_idx
      ON resource_cards (workspace_id)
      WHERE deleted_at IS NULL
    `;

    await sql`
      DROP INDEX IF EXISTS resource_categories_name_lower_idx
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS resource_categories_workspace_name_lower_idx
      ON resource_categories (workspace_id, (lower(name)))
    `;

    await sql`
      INSERT INTO resource_categories (name, workspace_id)
      SELECT
        'General',
        workspace.id
      FROM (
        SELECT id
        FROM resource_workspaces
        WHERE owner_user_id IS NULL
          AND lower(name) = lower('Main Workspace')
        ORDER BY created_at ASC
        LIMIT 1
      ) AS workspace
      ON CONFLICT (workspace_id, lower(name)) DO NOTHING
    `;

    await sql`
      INSERT INTO resource_categories (name, workspace_id, owner_user_id)
      SELECT DISTINCT
        trim(cards.category),
        cards.workspace_id,
        cards.owner_user_id
      FROM resource_cards AS cards
      WHERE trim(cards.category) <> ''
      ON CONFLICT (workspace_id, lower(name)) DO NOTHING
    `;

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'resource_categories_workspace_id_resource_workspaces_id_fk'
        ) THEN
          ALTER TABLE resource_categories
          ADD CONSTRAINT resource_categories_workspace_id_resource_workspaces_id_fk
          FOREIGN KEY (workspace_id)
          REFERENCES resource_workspaces(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `;

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'resource_cards_workspace_id_resource_workspaces_id_fk'
        ) THEN
          ALTER TABLE resource_cards
          ADD CONSTRAINT resource_cards_workspace_id_resource_workspaces_id_fk
          FOREIGN KEY (workspace_id)
          REFERENCES resource_workspaces(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `;

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'resource_cards_owner_user_id_app_users_id_fk'
        ) THEN
          ALTER TABLE resource_cards
          ADD CONSTRAINT resource_cards_owner_user_id_app_users_id_fk
          FOREIGN KEY (owner_user_id)
          REFERENCES app_users(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL CHECK (char_length(token_hash) = 64),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx
      ON email_verification_tokens (user_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at_idx
      ON email_verification_tokens (expires_at DESC)
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_token_hash_idx
      ON email_verification_tokens (token_hash)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS color_scheme_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
        visitor_id UUID,
        color_scheme TEXT NOT NULL CHECK (char_length(color_scheme) <= 64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT color_scheme_preferences_target_check
          CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS color_scheme_preferences_user_id_idx
      ON color_scheme_preferences (user_id)
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS color_scheme_preferences_visitor_id_idx
      ON color_scheme_preferences (visitor_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS color_scheme_preferences_updated_at_idx
      ON color_scheme_preferences (updated_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resource_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id UUID NOT NULL REFERENCES resource_cards(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('archived', 'restored')),
        actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
        actor_identifier TEXT NOT NULL CHECK (char_length(actor_identifier) <= 320),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_audit_logs_created_at_idx
      ON resource_audit_logs (created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_audit_logs_resource_id_created_at_idx
      ON resource_audit_logs (resource_id, created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS resource_audit_logs_actor_user_id_created_at_idx
      ON resource_audit_logs (actor_user_id, created_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS favicon_cache (
        hostname TEXT PRIMARY KEY CHECK (char_length(hostname) <= 253),
        favicon_url TEXT,
        favicon_content_type TEXT,
        favicon_base64 TEXT,
        favicon_hash TEXT,
        last_checked_at TIMESTAMPTZ NOT NULL,
        last_changed_at TIMESTAMPTZ NOT NULL
      )
    `;

    await sql`
      ALTER TABLE favicon_cache
      ADD COLUMN IF NOT EXISTS favicon_content_type TEXT
    `;

    await sql`
      ALTER TABLE favicon_cache
      ADD COLUMN IF NOT EXISTS favicon_base64 TEXT
    `;

    await sql`
      ALTER TABLE favicon_cache
      ADD COLUMN IF NOT EXISTS favicon_hash TEXT
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS favicon_cache_last_checked_at_idx
      ON favicon_cache (last_checked_at ASC)
    `;
  })();

  await schemaReady;
}
