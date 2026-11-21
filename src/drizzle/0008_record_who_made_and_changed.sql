ALTER TABLE "api_keys" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_parts" ADD COLUMN "updated_by_api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "email_parts" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "updated_by_api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by_user_id" uuid;