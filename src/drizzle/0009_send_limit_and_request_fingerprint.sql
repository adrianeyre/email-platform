ALTER TABLE "api_keys" ADD COLUMN "send_window_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "send_window_recipients" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "request_fingerprint" text;