-- ADR-0163 #2: an admin's ticks on a system role, as differences from the code's set.
CREATE TABLE "role_permission_overrides" (
	"role_id" bigint NOT NULL,
	"permission_code" text NOT NULL,
	"granted" boolean NOT NULL,
	CONSTRAINT "role_permission_overrides_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
ALTER TABLE "role_permission_overrides" ADD CONSTRAINT "role_permission_overrides_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission_overrides" ADD CONSTRAINT "role_permission_overrides_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;