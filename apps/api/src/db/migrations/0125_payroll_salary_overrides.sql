-- ADR-0244: an employee's fixed salary can differ from the position's default.
-- No existing salary, position or approved payroll row is changed.
CREATE TABLE "payroll_salary_overrides" (
  "user_id" bigint NOT NULL CONSTRAINT "payroll_salary_overrides_user_id_users_id_fk" REFERENCES "users"("id"),
  "effective_month" text NOT NULL,
  "base_salary" numeric(14,2),
  "updated_by" bigint CONSTRAINT "payroll_salary_overrides_updated_by_users_id_fk" REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_salary_overrides_user_id_effective_month_pk" PRIMARY KEY ("user_id", "effective_month"),
  CONSTRAINT "payroll_salary_overrides_month" CHECK ("effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_salary_overrides_nonnegative" CHECK ("base_salary" >= 0 AND "base_salary" <> 'NaN'::numeric)
);--> statement-breakpoint
CREATE FUNCTION payroll_salary_override_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'employee salary history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.effective_month <> next_month THEN
    RAISE EXCEPTION 'employee salary changes start next month' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.effective_month <> OLD.effective_month) THEN
    RAISE EXCEPTION 'employee salary history keys cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payroll_salary_override_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_salary_overrides
FOR EACH ROW EXECUTE FUNCTION payroll_salary_override_history_guard();--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON payroll_salary_overrides FROM app;
