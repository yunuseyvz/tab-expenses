CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"settled_on" date NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_amount_positive" CHECK ("settlement"."amount_minor" > 0),
	CONSTRAINT "settlement_distinct_members" CHECK ("settlement"."from_member_id" <> "settlement"."to_member_id")
);
--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_from_member_id_space_member_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."space_member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_to_member_id_space_member_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."space_member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_space_date_idx" ON "settlement" USING btree ("space_id","settled_on" DESC NULLS LAST);