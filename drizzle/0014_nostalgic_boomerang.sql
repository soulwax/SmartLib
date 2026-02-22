CREATE TABLE "resource_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_organizations_name_length_check" CHECK (char_length("resource_organizations"."name") <= 80)
);
--> statement-breakpoint
ALTER TABLE "resource_workspaces" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_organizations" ADD CONSTRAINT "resource_organizations_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_organizations_name_lower_idx" ON "resource_organizations" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "resource_organizations_created_at_idx" ON "resource_organizations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "resource_organizations_owner_user_id_idx" ON "resource_organizations" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "resource_workspaces" ADD CONSTRAINT "resource_workspaces_organization_id_resource_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."resource_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_workspaces_organization_id_idx" ON "resource_workspaces" USING btree ("organization_id");