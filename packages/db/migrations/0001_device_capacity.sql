CREATE TABLE "message_part_reports" (
	"message_id" uuid NOT NULL,
	"event" text NOT NULL,
	"part_index" smallint NOT NULL,
	"result_code" integer,
	"result_name" text,
	"reported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_part_reports_message_id_event_part_index_pk" PRIMARY KEY("message_id","event","part_index")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "slots_on_device" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "rotate_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_part_reports" ADD CONSTRAINT "message_part_reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;