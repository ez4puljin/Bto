CREATE TABLE "edge_link" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"central_url" text NOT NULL,
	"node_id" bigint NOT NULL,
	"node_code" text NOT NULL,
	"node_name" text NOT NULL,
	"token" text NOT NULL,
	"pin_pepper" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_link_single_row" CHECK ("edge_link"."id" = 1)
);
