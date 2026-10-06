ALTER TABLE "spaces" ADD COLUMN "mailbox_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_mailbox_id_unique" UNIQUE("mailbox_id");