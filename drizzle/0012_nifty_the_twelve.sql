CREATE TABLE "recurring_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"category_id" uuid,
	"paid_by_member_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"anchor_day" integer NOT NULL,
	"starts_on" date NOT NULL,
	"next_due_on" date NOT NULL,
	"locked" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expense_amount_positive" CHECK ("recurring_expense"."amount_minor" > 0),
	CONSTRAINT "recurring_expense_frequency" CHECK ("recurring_expense"."frequency" in ('monthly', 'weekly')),
	CONSTRAINT "recurring_expense_anchor_day" CHECK ("recurring_expense"."anchor_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "recurring_expense_split" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weight_bp" integer NOT NULL,
	CONSTRAINT "recurring_expense_split_weight_range" CHECK ("recurring_expense_split"."weight_bp" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "period_key" text;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_paid_by_member_id_space_member_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."space_member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_split" ADD CONSTRAINT "recurring_expense_split_recurring_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_split" ADD CONSTRAINT "recurring_expense_split_member_id_space_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."space_member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_expense_due_idx" ON "recurring_expense" USING btree ("space_id","next_due_on") WHERE "recurring_expense"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_expense_split_uq" ON "recurring_expense_split" USING btree ("recurring_id","member_id");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_recurring_period_uq" ON "expense" USING btree ("recurring_id","period_key");