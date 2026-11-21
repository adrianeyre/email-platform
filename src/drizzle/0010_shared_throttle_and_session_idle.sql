CREATE TABLE "throttle_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_used_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "throttle_keys_expires_at_idx" ON "throttle_keys" USING btree ("expires_at");