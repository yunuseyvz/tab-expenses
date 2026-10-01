ALTER TABLE "space_invite" ADD COLUMN "invited_by_user_id" text;--> statement-breakpoint
ALTER TABLE "space_invite" ADD CONSTRAINT "space_invite_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_invite_email_idx" ON "space_invite" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "space_invite_live_uq" ON "space_invite" USING btree ("space_id","email") WHERE "space_invite"."accepted_at" is null;