CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"routing_key" text NOT NULL,
	"message_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
