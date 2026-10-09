/** DI token carrying which entrypoint is running ('api' or 'worker'). */
export const PROCESS_ROLE = Symbol('PROCESS_ROLE');
export type { ProcessRole } from './env.schema';
