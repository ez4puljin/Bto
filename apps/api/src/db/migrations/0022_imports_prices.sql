-- The price sheet import (ADR-0054): a sixth import kind, PRICES.
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind" CHECK ("import_jobs"."kind" IN ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'LEVELS', 'PRICES'));
