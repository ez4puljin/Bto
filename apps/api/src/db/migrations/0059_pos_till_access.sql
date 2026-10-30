CREATE TABLE "pos_till_categories" (
	"till_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_till_categories_till_id_category_id_pk" PRIMARY KEY("till_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "pos_till_users" (
	"till_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_till_users_till_id_user_id_role_pk" PRIMARY KEY("till_id","user_id","role"),
	CONSTRAINT "pos_till_users_role" CHECK ("pos_till_users"."role" IN ('CASHIER', 'SUPERVISOR'))
);
--> statement-breakpoint
ALTER TABLE "pos_till_categories" ADD CONSTRAINT "pos_till_categories_till_id_pos_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."pos_tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_till_categories" ADD CONSTRAINT "pos_till_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_till_users" ADD CONSTRAINT "pos_till_users_till_id_pos_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."pos_tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_till_users" ADD CONSTRAINT "pos_till_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_till_users_user_idx" ON "pos_till_users" USING btree ("user_id");