ALTER TABLE "sales_stages" DROP CONSTRAINT "sales_stages_action";--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD COLUMN "transfer_warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_transfer_warehouse_id_warehouses_id_fk" FOREIGN KEY ("transfer_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_action" CHECK ("sales_stages"."action" IN ('NONE', 'CONFIRM', 'PICK', 'SALE', 'TRANSFER', 'CANCEL'));