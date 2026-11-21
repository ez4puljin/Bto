-- ADR-0235, amended 2026-11-21 (owner): the fixed salary of someone who joined or left inside the
-- month is split by their planned workdays. Only adds (ADR-0206): three nullable columns on
-- payroll_lines; a line computed before this rule keeps NULL (its base_salary was paid whole).
ALTER TABLE "payroll_lines" ADD COLUMN "salary_paid" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "salary_days" integer;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "salary_month_days" integer;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_salary_days" CHECK (("payroll_lines"."salary_days" IS NULL) = ("payroll_lines"."salary_month_days" IS NULL) AND ("payroll_lines"."salary_days" IS NULL OR "payroll_lines"."salary_days" BETWEEN 0 AND "payroll_lines"."salary_month_days"));--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_salary_paid" CHECK ("payroll_lines"."salary_paid" IS NULL OR "payroll_lines"."salary_paid" >= 0);