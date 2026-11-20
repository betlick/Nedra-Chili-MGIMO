CREATE TABLE "student_document_profiles" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"birth_date" date NOT NULL,
	"study_form" text NOT NULL,
	"funding_basis" text NOT NULL,
	"enrollment_date" date NOT NULL,
	"enrollment_order" text NOT NULL,
	"expected_graduation_date" date NOT NULL,
	"phone" text NOT NULL,
	"enrollment_status" text NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_profile_dates" CHECK ("student_document_profiles"."birth_date" < "student_document_profiles"."enrollment_date" and "student_document_profiles"."enrollment_date" < "student_document_profiles"."expected_graduation_date"),
	CONSTRAINT "document_profile_status" CHECK ("student_document_profiles"."enrollment_status" in ('active', 'suspended', 'withdrawn', 'graduated'))
);
--> statement-breakpoint
ALTER TABLE "student_document_profiles" ADD CONSTRAINT "student_document_profiles_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;