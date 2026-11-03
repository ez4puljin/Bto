ALTER TABLE "pos_edge_nodes" ADD COLUMN "link_code_hash" text;--> statement-breakpoint
ALTER TABLE "pos_edge_nodes" ADD COLUMN "link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_edge_nodes" ADD COLUMN "link_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_edge_nodes" ADD CONSTRAINT "pos_edge_nodes_link" CHECK (("pos_edge_nodes"."link_code_hash" IS NULL) = ("pos_edge_nodes"."link_expires_at" IS NULL) AND "pos_edge_nodes"."link_attempts" >= 0);