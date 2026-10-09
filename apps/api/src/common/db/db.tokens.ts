/** The node-postgres Pool of this process (role app). */
export const DB_POOL = Symbol('DB_POOL');
/** The Drizzle database bound to DB_POOL. */
export const DB = Symbol('DB');
