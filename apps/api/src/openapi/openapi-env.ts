// Placeholders so the module graph can be built without a database: the pg Pool and pg-boss
// connect lazily, and the export never calls init()/listen(). Must be the first import of the export.
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgres://openapi:openapi@127.0.0.1:1/openapi';
process.env.DB_POOL_MAX ??= '1';
process.env.PGBOSS_POOL_MAX ??= '1';
process.env.JWT_SECRET ??= 'openapi-export-placeholder-0123456789abcdef';
process.env.AUTH_PEPPER ??= 'openapi-export-placeholder-0123456789abcdef';
// Never written: the export builds the module graph only.
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR ??= 'openapi-export-storage';
// The AI assistant's settings do not change the document (ADR-0045); CI sets AI_DATABASE_URL for
// the tests without the api's AI_POOL_MAX, so the export runs with the assistant off.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('LLM_') || key.startsWith('AI_')) delete process.env[key];
}

export {};
