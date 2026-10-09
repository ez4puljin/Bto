import { defineConfig } from 'drizzle-kit';

// generate/check only: no credentials here. `drizzle-kit push` is banned (ADR-0003); migrations are
// applied by src/db/migrate.ts as role migrator (ADR-0024).
export default defineConfig({
  dialect: 'postgresql',
  // The single aggregated schema entry; it always exists, so generate works with zero tables.
  schema: './src/db/schema.ts',
  // Keep RELATIVE: drizzle-kit 0.31 reads snapshots as `./${out}/...`.
  out: './src/db/migrations',
  breakpoints: true,
  migrations: { prefix: 'index', schema: 'drizzle', table: '__drizzle_migrations' },
});
