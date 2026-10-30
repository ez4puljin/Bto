-- By hand (ADR-0123): a till sells from its own STORE warehouse; every existing till takes its edge's.
ALTER TABLE "pos_tills" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
UPDATE "pos_tills" t SET "warehouse_id" = n."warehouse_id" FROM "pos_edge_nodes" n WHERE n."id" = t."edge_node_id";--> statement-breakpoint
ALTER TABLE "pos_tills" ALTER COLUMN "warehouse_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tills" ADD CONSTRAINT "pos_tills_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_tills_warehouse_idx" ON "pos_tills" USING btree ("warehouse_id");
