ALTER TABLE "notifications" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "previous_type" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "type_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "type_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_type_changed_by_users_id_fk" FOREIGN KEY ("type_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;