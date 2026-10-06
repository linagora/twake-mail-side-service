CREATE TABLE "organizations" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"mail_validated" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_members_user_id_index" ON "space_members" USING btree ("user_id");