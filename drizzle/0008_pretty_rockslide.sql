CREATE TABLE IF NOT EXISTS "favicon_cache" (
	"hostname" text PRIMARY KEY NOT NULL,
	"favicon_url" text,
	"favicon_content_type" text,
	"favicon_base64" text,
	"favicon_hash" text,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "favicon_cache_hostname_length_check" CHECK (char_length("favicon_cache"."hostname") <= 253),
	CONSTRAINT "favicon_cache_hash_length_check" CHECK ("favicon_cache"."favicon_hash" IS NULL OR char_length("favicon_cache"."favicon_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favicon_cache_last_checked_at_idx" ON "favicon_cache" USING btree ("last_checked_at");
