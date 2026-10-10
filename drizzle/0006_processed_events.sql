CREATE TABLE "processed_events" (
	"source" text NOT NULL,
	"id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_source_id_pk" PRIMARY KEY("source","id")
);
--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_index" ON "processed_events" USING btree ("processed_at");