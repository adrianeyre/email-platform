CREATE TABLE "email_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"html" text NOT NULL,
	"design" jsonb,
	"sample_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_parts_kind_name_unique" UNIQUE("kind","name"),
	CONSTRAINT "email_parts_kind_check" CHECK ("email_parts"."kind" in ('header', 'footer'))
);
--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "header_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "footer_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_header_id_email_parts_id_fk" FOREIGN KEY ("header_id") REFERENCES "public"."email_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_footer_id_email_parts_id_fk" FOREIGN KEY ("footer_id") REFERENCES "public"."email_parts"("id") ON DELETE set null ON UPDATE no action;