CREATE TABLE "parked_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"properties" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"reason" text NOT NULL,
	"parked_at" timestamp with time zone DEFAULT now() NOT NULL
);
