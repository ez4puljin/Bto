CREATE TABLE "pos_cashier_tills" (
	"user_id" bigint NOT NULL,
	"till_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_cashier_tills_user_id_till_id_pk" PRIMARY KEY("user_id","till_id")
);
--> statement-breakpoint
ALTER TABLE "pos_cashier_tills" ADD CONSTRAINT "pos_cashier_tills_user_id_pos_cashiers_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pos_cashiers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cashier_tills" ADD CONSTRAINT "pos_cashier_tills_till_id_pos_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."pos_tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_cashier_tills_till_idx" ON "pos_cashier_tills" USING btree ("till_id");