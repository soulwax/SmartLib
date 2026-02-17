CREATE TABLE "resource_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_workspaces_name_length_check" CHECK (char_length("resource_workspaces"."name") <= 80)
);
--> statement-breakpoint
DROP INDEX "resource_categories_name_lower_idx";--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "role" text DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_cards" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_cards" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_workspaces" ADD CONSTRAINT "resource_workspaces_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_workspaces_owner_name_lower_idx" ON "resource_workspaces" USING btree (coalesce("owner_user_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "resource_workspaces_created_at_idx" ON "resource_workspaces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "resource_workspaces_owner_user_id_idx" ON "resource_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "resource_cards" ADD CONSTRAINT "resource_cards_workspace_id_resource_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."resource_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_cards" ADD CONSTRAINT "resource_cards_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_workspace_id_resource_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."resource_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_cards_workspace_id_idx" ON "resource_cards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "resource_cards_owner_user_id_idx" ON "resource_cards" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_categories_workspace_name_lower_idx" ON "resource_categories" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "resource_categories_workspace_id_idx" ON "resource_categories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "resource_categories_owner_user_id_idx" ON "resource_categories" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_role_check" CHECK ("app_users"."role" IN ('viewer', 'editor', 'admin', 'first_admin'));