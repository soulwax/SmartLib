CREATE TABLE "toby_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid,
	"created_by_identifier" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"organization_id" uuid,
	"workspace_name" text NOT NULL,
	"source_name" text,
	"created_workspace_id" uuid,
	"imported_lists" integer DEFAULT 0 NOT NULL,
	"imported_cards" integer DEFAULT 0 NOT NULL,
	"imported_resources" integer DEFAULT 0 NOT NULL,
	"skipped_exact_duplicates" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by_user_id" uuid,
	"rolled_back_by_identifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "toby_import_batches_created_by_identifier_length_check" CHECK (char_length("toby_import_batches"."created_by_identifier") <= 320),
	CONSTRAINT "toby_import_batches_workspace_name_length_check" CHECK (char_length("toby_import_batches"."workspace_name") <= 80),
	CONSTRAINT "toby_import_batches_source_name_length_check" CHECK ("toby_import_batches"."source_name" IS NULL OR char_length("toby_import_batches"."source_name") <= 200),
	CONSTRAINT "toby_import_batches_rolled_back_by_identifier_length_check" CHECK ("toby_import_batches"."rolled_back_by_identifier" IS NULL OR char_length("toby_import_batches"."rolled_back_by_identifier") <= 320),
	CONSTRAINT "toby_import_batches_imported_lists_check" CHECK ("toby_import_batches"."imported_lists" >= 0),
	CONSTRAINT "toby_import_batches_imported_cards_check" CHECK ("toby_import_batches"."imported_cards" >= 0),
	CONSTRAINT "toby_import_batches_imported_resources_check" CHECK ("toby_import_batches"."imported_resources" >= 0),
	CONSTRAINT "toby_import_batches_skipped_exact_duplicates_check" CHECK ("toby_import_batches"."skipped_exact_duplicates" >= 0),
	CONSTRAINT "toby_import_batches_failed_check" CHECK ("toby_import_batches"."failed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "toby_import_batches" ADD CONSTRAINT "toby_import_batches_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toby_import_batches" ADD CONSTRAINT "toby_import_batches_workspace_id_resource_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."resource_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toby_import_batches" ADD CONSTRAINT "toby_import_batches_organization_id_resource_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."resource_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toby_import_batches" ADD CONSTRAINT "toby_import_batches_created_workspace_id_resource_workspaces_id_fk" FOREIGN KEY ("created_workspace_id") REFERENCES "public"."resource_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toby_import_batches" ADD CONSTRAINT "toby_import_batches_rolled_back_by_user_id_app_users_id_fk" FOREIGN KEY ("rolled_back_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "toby_import_batches_created_at_idx" ON "toby_import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "toby_import_batches_created_by_user_id_created_at_idx" ON "toby_import_batches" USING btree ("created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "toby_import_batches_workspace_id_created_at_idx" ON "toby_import_batches" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "toby_import_batches_rolled_back_at_idx" ON "toby_import_batches" USING btree ("rolled_back_at");