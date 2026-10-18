import { defineConfig } from 'drizzle-kit';

// The store edge's own schema (ADR-0067): generate/check only, no credentials here; migrations
// are applied by src/edge/db/migrate.ts. `drizzle-kit push` is banned (ADR-0003).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/edge/db/schema.ts',
  // Keep RELATIVE: drizzle-kit 0.31 reads snapshots as `./${out}/...`.
  out: './src/edge/db/migrations',
  breakpoints: true,
  migrations: { prefix: 'index', schema: 'drizzle', table: '__drizzle_migrations' },
});
