ALTER TABLE "requests" ADD COLUMN "assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "document_docx_base64" text;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignment_id_teaching_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."teaching_assignments"("id") ON DELETE no action ON UPDATE no action;