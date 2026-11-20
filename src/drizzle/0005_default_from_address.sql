ALTER TABLE "settings" ALTER COLUMN "default_from" SET DEFAULT 'no-reply@adrianeyre.co.uk';--> statement-breakpoint
-- Every install without a default from address gets this one. It can still be changed or cleared in Delivery.
UPDATE "settings" SET "default_from" = 'no-reply@adrianeyre.co.uk' WHERE "default_from" IS NULL;
