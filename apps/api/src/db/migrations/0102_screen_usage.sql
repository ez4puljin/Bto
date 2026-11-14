CREATE TABLE "screen_usage" (
	"day" date NOT NULL,
	"app" text NOT NULL,
	"screen" text NOT NULL,
	"opens" bigint DEFAULT 0 NOT NULL,
	"seconds" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "screen_usage_pkey" PRIMARY KEY("day","app","screen"),
	CONSTRAINT "screen_usage_app" CHECK ("screen_usage"."app" IN ('web', 'staff', 'customer')),
	CONSTRAINT "screen_usage_screen" CHECK (length("screen_usage"."screen") BETWEEN 1 AND 120),
	CONSTRAINT "screen_usage_counts" CHECK ("screen_usage"."opens" >= 0 AND "screen_usage"."seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "screen_usage_seen" (
	"day" date NOT NULL,
	"app" text NOT NULL,
	"screen" text NOT NULL,
	"actor" text NOT NULL,
	CONSTRAINT "screen_usage_seen_pkey" PRIMARY KEY("day","app","screen","actor"),
	CONSTRAINT "screen_usage_seen_app" CHECK ("screen_usage_seen"."app" IN ('web', 'staff', 'customer')),
	CONSTRAINT "screen_usage_seen_screen" CHECK (length("screen_usage_seen"."screen") BETWEEN 1 AND 120),
	CONSTRAINT "screen_usage_seen_actor" CHECK ("screen_usage_seen"."actor" ~ '^[sc][0-9]{1,18}$')
);
