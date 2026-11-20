ALTER TABLE "settings" ALTER COLUMN "smtp_host" SET DEFAULT 'postfix';--> statement-breakpoint
-- Every install without an SMTP host sends through the Postfix service (ADR 0008). Another provider can still be set in Delivery.
UPDATE "settings" SET "smtp_host" = 'postfix' WHERE "smtp_host" IS NULL;
