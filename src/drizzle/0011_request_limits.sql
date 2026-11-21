ALTER TABLE "api_keys" ADD COLUMN "request_tokens" double precision;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "request_tokens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "preview_window_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "preview_window_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "request_tokens" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "request_tokens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "test_send_window_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "test_send_window_count" integer DEFAULT 0 NOT NULL;