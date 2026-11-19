import type { AuthContext } from '../../identity';

/**
 * Marks a till shortfall checked. The api binds it to the pos module's own resolve
 * (`PosQueryService.resolveShortfall`); the worker binds `WorkerShortfallResolver`, so the worker
 * never imports the pos module, whose PIN hasher needs a pepper the worker is not given.
 */
export abstract class ShortfallResolver {
  abstract resolveShortfall(ctx: AuthContext, id: number, note: string | null): Promise<unknown>;
}

/**
 * The worker's binding. The worker only builds the 07:00 sheets with no user (`sync(null)`), and
 * only a manager's context resolves shortfalls, so this is never reached there.
 */
export class WorkerShortfallResolver extends ShortfallResolver {
  resolveShortfall(): Promise<unknown> {
    return Promise.reject(new Error('the worker does not resolve till shortfalls'));
  }
}
