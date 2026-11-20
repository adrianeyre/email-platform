ALTER TABLE "settings" ALTER COLUMN "smtp_host" DROP DEFAULT;--> statement-breakpoint
-- The Postfix service is gone (ADR 0009), so an install still pointed at it has no SMTP provider until one is set in Delivery.
UPDATE "settings" SET "smtp_host" = NULL WHERE "smtp_host" = 'postfix';
