CREATE TABLE "ask_library_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"conversation_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_question" text,
	"last_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_library_threads_title_length_check" CHECK (char_length("ask_library_threads"."title") <= 120)
);
--> statement-breakpoint
ALTER TABLE "resource_cards" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_cards" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_library_threads" ADD CONSTRAINT "ask_library_threads_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_library_threads" ADD CONSTRAINT "ask_library_threads_workspace_id_resource_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."resource_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_library_threads_user_id_updated_at_idx" ON "ask_library_threads" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ask_library_threads_workspace_id_updated_at_idx" ON "ask_library_threads" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "resource_cards" ADD CONSTRAINT "resource_cards_category_id_resource_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resource_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_cards_category_id_idx" ON "resource_cards" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "resource_cards_workspace_category_sort_idx" ON "resource_cards" USING btree ("workspace_id","category_id","sort_order");--> statement-breakpoint
ALTER TABLE "resource_cards" ADD CONSTRAINT "resource_cards_sort_order_check" CHECK ("resource_cards"."sort_order" >= 0);