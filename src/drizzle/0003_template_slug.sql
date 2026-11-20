ALTER TABLE "templates" ADD COLUMN "slug" text;--> statement-breakpoint
-- Gives each existing template a slug from its name, as slugify() in src/templates/slug.ts does: accents dropped,
-- lowercase, each run of other characters one hyphen, no hyphen at either end, at most 100 characters, and "template"
-- when nothing is left. Oldest first, a slug already given gets -2, -3… on the end.
DO $$
DECLARE
	template record;
	base text;
	candidate text;
	suffix text;
	number integer;
BEGIN
	FOR template IN SELECT "id", "name" FROM "templates" ORDER BY "created_at", "id" LOOP
		base := lower(regexp_replace(normalize(template."name", NFKD), '[̀-ͯ]', '', 'g'));
		base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
		base := trim(both '-' from left(base, 100));
		IF base = '' THEN
			base := 'template';
		END IF;
		candidate := base;
		number := 1;
		WHILE EXISTS (SELECT 1 FROM "templates" WHERE "slug" = candidate) LOOP
			number := number + 1;
			suffix := '-' || number::text;
			candidate := trim(both '-' from left(base, 100 - length(suffix))) || suffix;
		END LOOP;
		UPDATE "templates" SET "slug" = candidate WHERE "id" = template."id";
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_slug_unique" UNIQUE("slug");
