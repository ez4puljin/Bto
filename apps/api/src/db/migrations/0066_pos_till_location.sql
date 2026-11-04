ALTER TABLE "pos_edge_nodes" DROP CONSTRAINT "pos_edge_nodes_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "pos_edge_nodes" DROP COLUMN "warehouse_id";