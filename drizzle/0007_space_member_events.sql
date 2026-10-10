ALTER TABLE "space_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "last_event_at" timestamp with time zone;