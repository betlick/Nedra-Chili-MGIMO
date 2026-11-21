ALTER TABLE "requests" ADD COLUMN "ai_purpose" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "ai_prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "automated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "automation_reason" text;