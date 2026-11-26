ALTER TABLE "alerts" ADD COLUMN "last_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "is_opt_out_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD COLUMN "number_enc" text;