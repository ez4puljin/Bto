-- ADR-0243. Additive rollout: old cards, roles and salaries are deliberately not inferred.
ALTER TABLE "users" ADD COLUMN "roles_managed_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_roles_managed_by" CHECK ("roles_managed_by" IS NULL OR "roles_managed_by" = 'HR_POSITION');--> statement-breakpoint
CREATE TABLE "hr_positions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "archived_at" timestamptz,
  "created_by" bigint CONSTRAINT "hr_positions_created_by_users_id_fk" REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" bigint CONSTRAINT "hr_positions_updated_by_users_id_fk" REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hr_positions_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE UNIQUE INDEX "hr_positions_name_key" ON "hr_positions" (lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE TABLE "hr_position_roles" (
  "position_id" bigint NOT NULL CONSTRAINT "hr_position_roles_position_id_hr_positions_id_fk" REFERENCES "hr_positions"("id"),
  "role_id" bigint NOT NULL CONSTRAINT "hr_position_roles_role_id_roles_id_fk" REFERENCES "roles"("id"),
  CONSTRAINT "hr_position_roles_position_id_role_id_pk" PRIMARY KEY ("position_id", "role_id")
);--> statement-breakpoint
CREATE INDEX "hr_position_roles_role_idx" ON "hr_position_roles" ("role_id");--> statement-breakpoint
CREATE TABLE "hr_position_salaries" (
  "position_id" bigint NOT NULL CONSTRAINT "hr_position_salaries_position_id_hr_positions_id_fk" REFERENCES "hr_positions"("id"),
  "effective_month" text NOT NULL,
  "base_salary" numeric(14,2) NOT NULL,
  "updated_by" bigint CONSTRAINT "hr_position_salaries_updated_by_users_id_fk" REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hr_position_salaries_position_id_effective_month_pk" PRIMARY KEY ("position_id", "effective_month"),
  CONSTRAINT "hr_position_salaries_month" CHECK ("effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "hr_position_salaries_nonnegative" CHECK ("base_salary" >= 0)
);--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "position_id" bigint CONSTRAINT "hr_employees_position_id_hr_positions_id_fk" REFERENCES "hr_positions"("id");--> statement-breakpoint
CREATE INDEX "hr_employees_position_idx" ON "hr_employees" ("position_id");--> statement-breakpoint
CREATE TABLE "hr_employee_position_assignments" (
  "user_id" bigint NOT NULL CONSTRAINT "hr_employee_position_assignments_user_id_users_id_fk" REFERENCES "users"("id"),
  "position_id" bigint NOT NULL CONSTRAINT "hr_employee_position_assignments_position_id_hr_positions_id_fk" REFERENCES "hr_positions"("id"),
  "effective_month" text NOT NULL,
  "assigned_by" bigint CONSTRAINT "hr_employee_position_assignments_assigned_by_users_id_fk" REFERENCES "users"("id"),
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hr_employee_position_assignments_user_id_effective_month_pk" PRIMARY KEY ("user_id", "effective_month"),
  CONSTRAINT "hr_employee_position_assignments_month" CHECK ("effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);--> statement-breakpoint
CREATE INDEX "hr_employee_position_assignments_position_idx" ON "hr_employee_position_assignments" ("position_id");--> statement-breakpoint
-- NULL preserves pre-position legacy terms without populating or updating existing rows.
-- New rows default to false; services interpret NULL only on an existing row as legacy.
ALTER TABLE "payroll_terms" ADD COLUMN "position_legacy_salary" boolean;--> statement-breakpoint
ALTER TABLE "payroll_terms" ALTER COLUMN "position_legacy_salary" SET DEFAULT false;--> statement-breakpoint

CREATE FUNCTION hr_position_assignment_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_month text := to_char(timezone('Asia/Ulaanbaatar', now()), 'YYYY-MM');
  next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.effective_month <> next_month AND NOT (
      NEW.effective_month = current_month
      AND NOT EXISTS (SELECT 1 FROM hr_employee_position_assignments WHERE user_id = NEW.user_id)
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND created_at = transaction_timestamp())
    ) THEN
      RAISE EXCEPTION 'existing employee salary assignments start next month' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.user_id <> OLD.user_id OR NEW.effective_month <> OLD.effective_month OR OLD.effective_month <= current_month THEN
    RAISE EXCEPTION 'effective employee salary assignments cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER hr_position_assignment_history_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_employee_position_assignments
FOR EACH ROW EXECUTE FUNCTION hr_position_assignment_history_guard();--> statement-breakpoint

-- A salary in force is history. Only a not-yet-effective rate may be revised.
CREATE FUNCTION hr_position_salary_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_month text := to_char(timezone('Asia/Ulaanbaatar', now()), 'YYYY-MM');
  next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM hr_positions WHERE id = NEW.position_id FOR UPDATE;
    IF (NOT EXISTS (SELECT 1 FROM hr_position_salaries WHERE position_id = NEW.position_id) AND NEW.effective_month <> current_month)
      OR (EXISTS (SELECT 1 FROM hr_position_salaries WHERE position_id = NEW.position_id) AND NEW.effective_month <> next_month) THEN
      RAISE EXCEPTION 'initial salary is current month; later changes start next month' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.position_id <> OLD.position_id OR NEW.effective_month <> OLD.effective_month
    OR OLD.effective_month <= current_month THEN
    RAISE EXCEPTION 'position salary history cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER hr_position_salary_history_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_position_salaries
FOR EACH ROW EXECUTE FUNCTION hr_position_salary_history_guard();--> statement-breakpoint

-- Deferred checks allow the HR card and identity's roles to move in one transaction, and reject
-- a forgotten mirror or a direct manual edit when the transaction commits.
CREATE FUNCTION hr_position_check_user(target_user bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE position_ref bigint; owner_source text; actual_roles bigint[]; position_roles bigint[];
BEGIN
  SELECT e.position_id, u.roles_managed_by INTO position_ref, owner_source
    FROM users u LEFT JOIN hr_employees e ON e.user_id = u.id WHERE u.id = target_user;
  IF NOT FOUND THEN RETURN; END IF;
  IF position_ref IS NULL THEN
    IF owner_source IS NOT NULL THEN
      RAISE EXCEPTION 'position-managed account needs a position' USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;
  SELECT coalesce(array_agg(role_id ORDER BY role_id), '{}'::bigint[]) INTO actual_roles FROM user_roles WHERE user_id = target_user;
  SELECT coalesce(array_agg(role_id ORDER BY role_id), '{}'::bigint[]) INTO position_roles FROM hr_position_roles WHERE position_id = position_ref;
  IF owner_source IS DISTINCT FROM 'HR_POSITION' OR actual_roles IS DISTINCT FROM position_roles THEN
    RAISE EXCEPTION 'employee roles must match the assigned position' USING ERRCODE = '23514';
  END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION hr_position_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_id bigint; position_ref bigint;
BEGIN
  IF TG_TABLE_NAME = 'hr_position_roles' THEN
    IF TG_OP = 'DELETE' THEN position_ref := OLD.position_id; ELSE position_ref := NEW.position_id; END IF;
    FOR member_id IN SELECT user_id FROM hr_employees WHERE position_id = position_ref LOOP
      PERFORM hr_position_check_user(member_id);
    END LOOP;
    IF TG_OP = 'UPDATE' AND OLD.position_id <> NEW.position_id THEN
      FOR member_id IN SELECT user_id FROM hr_employees WHERE position_id = OLD.position_id LOOP
        PERFORM hr_position_check_user(member_id);
      END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    PERFORM hr_position_check_user(NEW.id);
  ELSE
    IF TG_OP = 'DELETE' THEN member_id := OLD.user_id; ELSE member_id := NEW.user_id; END IF;
    PERFORM hr_position_check_user(member_id);
    IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN PERFORM hr_position_check_user(OLD.user_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hr_employee_position_access_guard AFTER INSERT OR UPDATE OR DELETE ON hr_employees
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hr_position_roles_access_guard AFTER INSERT OR UPDATE OR DELETE ON hr_position_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_position_roles_access_guard AFTER INSERT OR UPDATE OR DELETE ON user_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_position_owner_guard AFTER INSERT OR UPDATE ON users
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON hr_positions, hr_position_salaries, hr_employee_position_assignments FROM app;
--> statement-breakpoint
REVOKE TRUNCATE ON hr_position_roles FROM app;
