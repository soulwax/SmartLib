CREATE TABLE IF NOT EXISTS "resource_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_workspaces_name_length_check" CHECK (char_length("resource_workspaces"."name") <= 80)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resource_workspaces_owner_user_id_app_users_id_fk'
	) THEN
		ALTER TABLE "resource_workspaces"
		ADD CONSTRAINT "resource_workspaces_owner_user_id_app_users_id_fk"
		FOREIGN KEY ("owner_user_id")
		REFERENCES "public"."app_users"("id")
		ON DELETE set null
		ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_workspaces_owner_name_lower_idx" ON "resource_workspaces" USING btree ((coalesce("owner_user_id", '00000000-0000-0000-0000-000000000000'::uuid)), (lower("name")));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_workspaces_created_at_idx" ON "resource_workspaces" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_workspaces_owner_user_id_idx" ON "resource_workspaces" USING btree ("owner_user_id");
--> statement-breakpoint
INSERT INTO "resource_workspaces" ("name", "owner_user_id")
VALUES ('Main Workspace', NULL)
ON CONFLICT ((coalesce("owner_user_id", '00000000-0000-0000-0000-000000000000'::uuid)), (lower("name"))) DO NOTHING;
--> statement-breakpoint
ALTER TABLE "resource_categories" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "resource_cards" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;
--> statement-breakpoint
UPDATE "resource_categories" AS cat
SET "workspace_id" = main_workspace.id
FROM (
	SELECT id
	FROM "resource_workspaces"
	WHERE "owner_user_id" IS NULL
		AND lower("name") = lower('Main Workspace')
	ORDER BY "created_at" ASC
	LIMIT 1
) AS main_workspace
WHERE cat."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "resource_cards" AS card
SET "workspace_id" = COALESCE(
	(
		SELECT assigned."workspace_id"
		FROM "resource_categories" AS assigned
		WHERE lower(assigned."name") = lower(card."category")
		ORDER BY assigned."created_at" ASC
		LIMIT 1
	),
	main_workspace.id
),
	"updated_at" = NOW()
FROM (
	SELECT id
	FROM "resource_workspaces"
	WHERE "owner_user_id" IS NULL
		AND lower("name") = lower('Main Workspace')
	ORDER BY "created_at" ASC
	LIMIT 1
) AS main_workspace
WHERE card."workspace_id" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "resource_categories_name_lower_idx";
--> statement-breakpoint
ALTER TABLE "resource_categories" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "resource_cards" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_categories_workspace_id_idx" ON "resource_categories" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_cards_workspace_id_idx" ON "resource_cards" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_categories_workspace_name_lower_idx" ON "resource_categories" USING btree ("workspace_id", (lower("name")));
--> statement-breakpoint
INSERT INTO "resource_categories" ("name", "workspace_id")
SELECT 'General', workspace.id
FROM (
	SELECT id
	FROM "resource_workspaces"
	WHERE "owner_user_id" IS NULL
		AND lower("name") = lower('Main Workspace')
	ORDER BY "created_at" ASC
	LIMIT 1
) AS workspace
ON CONFLICT ("workspace_id", lower("name")) DO NOTHING;
--> statement-breakpoint
INSERT INTO "resource_categories" ("name", "workspace_id", "owner_user_id")
SELECT DISTINCT trim(cards."category"), cards."workspace_id", cards."owner_user_id"
FROM "resource_cards" AS cards
WHERE trim(cards."category") <> ''
ON CONFLICT ("workspace_id", lower("name")) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resource_categories_workspace_id_resource_workspaces_id_fk'
	) THEN
		ALTER TABLE "resource_categories"
		ADD CONSTRAINT "resource_categories_workspace_id_resource_workspaces_id_fk"
		FOREIGN KEY ("workspace_id")
		REFERENCES "public"."resource_workspaces"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resource_cards_workspace_id_resource_workspaces_id_fk'
	) THEN
		ALTER TABLE "resource_cards"
		ADD CONSTRAINT "resource_cards_workspace_id_resource_workspaces_id_fk"
		FOREIGN KEY ("workspace_id")
		REFERENCES "public"."resource_workspaces"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END $$;
