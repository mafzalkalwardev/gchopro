ALTER TYPE "public"."block_reason" ADD VALUE 'limit_reached' BEFORE 'user_disabled';--> statement-breakpoint
ALTER TYPE "public"."hold_reason" ADD VALUE 'rate_segments';