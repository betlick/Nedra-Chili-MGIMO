ALTER TABLE "requests" ADD COLUMN "processing_mode" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "ai_note" text;