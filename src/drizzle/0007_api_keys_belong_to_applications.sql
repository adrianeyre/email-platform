CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "configurations" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "email_parts" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "application_id" uuid;--> statement-breakpoint
-- Until now every API Key could do everything, so an install that already has keys, Templates, Headers, Footers,
-- Configurations or Messages gets one Application holding all of them, and keeps working as it did. It is named after
-- the only key when there is one (a key is usually named after the application using it), and "Existing application"
-- otherwise; Users can rename it under API keys. A fresh install gets no Application.
INSERT INTO "applications" ("name")
SELECT CASE WHEN (SELECT count(*) FROM "api_keys") = 1
  THEN (SELECT "name" FROM "api_keys" LIMIT 1)
  ELSE 'Existing application' END
WHERE EXISTS (SELECT 1 FROM "api_keys")
  OR EXISTS (SELECT 1 FROM "templates")
  OR EXISTS (SELECT 1 FROM "email_parts")
  OR EXISTS (SELECT 1 FROM "configurations")
  OR EXISTS (SELECT 1 FROM "messages");--> statement-breakpoint
UPDATE "api_keys" SET "application_id" = (SELECT "id" FROM "applications" LIMIT 1);--> statement-breakpoint
UPDATE "templates" SET "application_id" = (SELECT "id" FROM "applications" LIMIT 1);--> statement-breakpoint
UPDATE "email_parts" SET "application_id" = (SELECT "id" FROM "applications" LIMIT 1);--> statement-breakpoint
UPDATE "configurations" SET "application_id" = (SELECT "id" FROM "applications" LIMIT 1);--> statement-breakpoint
UPDATE "messages" SET "application_id" = (SELECT "id" FROM "applications" LIMIT 1);--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_parts" ADD CONSTRAINT "email_parts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_application_idempotency_key_unique" UNIQUE("application_id","idempotency_key");
