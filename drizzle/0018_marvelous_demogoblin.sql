ALTER TABLE "favicon_cache" ADD COLUMN "fetch_etag" text;--> statement-breakpoint
ALTER TABLE "favicon_cache" ADD COLUMN "fetch_last_modified" text;--> statement-breakpoint
ALTER TABLE "favicon_cache" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
UPDATE "favicon_cache"
SET "next_check_at" = COALESCE("next_check_at", "last_checked_at" + INTERVAL '8 hours')
WHERE "next_check_at" IS NULL;--> statement-breakpoint
CREATE INDEX "favicon_cache_next_check_at_idx" ON "favicon_cache" USING btree ("next_check_at");
