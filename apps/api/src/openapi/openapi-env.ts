// Placeholders so the module graph can be built without a database: the pg Pool and pg-boss
// connect lazily, and the export never calls init()/listen(). Must be the first import of the export.
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgres://openapi:openapi@127.0.0.1:1/openapi';
process.env.DB_POOL_MAX ??= '1';
process.env.PGBOSS_POOL_MAX ??= '1';

export {};
