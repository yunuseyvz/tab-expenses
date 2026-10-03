CREATE TABLE "expense_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_note_body_not_blank" CHECK (length(btrim("expense_note"."body")) > 0),
	CONSTRAINT "expense_note_body_length" CHECK (length("expense_note"."body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_note" ADD CONSTRAINT "expense_note_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_note" ADD CONSTRAINT "expense_note_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_note" ADD CONSTRAINT "expense_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_note_expense_created_idx" ON "expense_note" USING btree ("expense_id","created_at");--> statement-breakpoint
ALTER TABLE "space" DROP COLUMN "editable_by_members";