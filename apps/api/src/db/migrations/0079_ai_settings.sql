CREATE TABLE "ai_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider" text,
	"model" text,
	"base_url" text,
	"api_key_sealed" text,
	"api_key_hint" text,
	"price_input_per_mtok" numeric(14, 4),
	"price_output_per_mtok" numeric(14, 4),
	"monthly_budget_usd" numeric(14, 2),
	"user_daily_questions" integer,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_single" CHECK ("ai_settings"."id" = 1),
	CONSTRAINT "ai_settings_provider" CHECK ("ai_settings"."provider" IS NULL OR ("ai_settings"."provider" IN ('openai', 'anthropic', 'ollama') AND "ai_settings"."model" IS NOT NULL)),
	CONSTRAINT "ai_settings_key" CHECK ("ai_settings"."provider" = 'ollama' OR "ai_settings"."provider" IS NULL OR "ai_settings"."api_key_sealed" IS NOT NULL),
	CONSTRAINT "ai_settings_prices" CHECK (("ai_settings"."price_input_per_mtok" IS NULL) = ("ai_settings"."price_output_per_mtok" IS NULL) AND coalesce("ai_settings"."price_input_per_mtok", 0) >= 0 AND coalesce("ai_settings"."price_output_per_mtok", 0) >= 0),
	CONSTRAINT "ai_settings_limits" CHECK (coalesce("ai_settings"."monthly_budget_usd", 1) > 0 AND coalesce("ai_settings"."user_daily_questions", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"purpose" text NOT NULL,
	"user_id" bigint,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_purpose" CHECK ("ai_usage"."purpose" IN ('ASK', 'INVOICE_CHECK')),
	CONSTRAINT "ai_usage_provider" CHECK ("ai_usage"."provider" IN ('openai', 'anthropic', 'ollama')),
	CONSTRAINT "ai_usage_counts" CHECK ("ai_usage"."input_tokens" >= 0 AND "ai_usage"."output_tokens" >= 0 AND coalesce("ai_usage"."cost_usd", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
-- Hand-written (ADR-0162): the settings row is rewritten in place, never deleted; the usage is a log,
-- append-only like ai_questions (ADR-0045 #8). ai_reader reads only schema ai, so it reads neither.
REVOKE DELETE, TRUNCATE ON "ai_settings" FROM app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "ai_usage" FROM app;
--> statement-breakpoint
CREATE TRIGGER "ai_usage_no_update_delete" BEFORE UPDATE OR DELETE ON "ai_usage"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER "ai_usage_no_truncate" BEFORE TRUNCATE ON "ai_usage"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
