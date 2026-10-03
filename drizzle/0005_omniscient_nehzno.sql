ALTER TABLE "space_member" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "space_member" ADD COLUMN "removal_ack_at" timestamp with time zone;