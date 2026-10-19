import { createHash } from 'node:crypto';
import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { catchError, from, map, mergeMap, type Observable, of, throwError } from 'rxjs';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { canonicalJson } from '../../../common/json/canonical';
import type { AuthenticatedRequest } from '../decorators/access.decorators';
import { idempotencyKeys } from '../schema';

export const IDEMPOTENT_KEY = 'tugeel:idempotent';
/** Nest's metadata key of @HttpCode (not exported from a public subpath). */
const HTTP_CODE_METADATA = '__httpCode__';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdempotentOptions {
  /**
   * Top-level response fields left out of the stored replay (ADR-0045 #8: an AI answer's rows are
   * never stored; a replay without them makes the client run the query again).
   */
  storeWithout?: readonly string[];
}

/**
 * Marks a document-creating route (ADR-0002 #6, ADR-0004 #5): the client sends a UUID
 * `Idempotency-Key`; a retry with the same key and body gets the stored response instead of a
 * second document. Use on authenticated routes only.
 */
export const Idempotent = (options: IdempotentOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, options),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'Client-generated UUID, kept until a response arrives',
    }),
  );

/** The response as stored for replays: without the fields the route keeps out of storage. */
function storable(body: unknown, without: readonly string[] = []): unknown {
  if (without.length === 0 || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([key]) => !without.includes(key)),
  );
}

export { canonicalJson };

/**
 * Global interceptor that acts only on @Idempotent() routes (ADR-0027 #11): the key row is claimed
 * (IN_PROGRESS) before the handler runs and completed with the response after it; a handler error
 * releases the key. The tiny window between the handler's commit and the completion is accepted.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const handler = context.getHandler();
    const options = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(
      IDEMPOTENT_KEY,
      [handler, context.getClass()],
    );
    if (!options) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request & AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    // A staff member or a customer app account (ADR-0079 #5): keys never collide across kinds.
    const actor = request.auth
      ? { kind: 'STAFF' as const, id: request.auth.userId }
      : request.customer
        ? { kind: 'CUSTOMER' as const, id: request.customer.customerUserId }
        : null;
    if (!actor) throw new Error('@Idempotent() needs an authenticated route');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !UUID.test(key)) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be a UUID');
    }
    const requestHash = createHash('sha256')
      .update(`${request.method}\n${request.originalUrl}\n${canonicalJson(request.body)}`)
      .digest('hex');
    const [claimed] = await this.db
      .insert(idempotencyKeys)
      .values({
        actorKind: actor.kind,
        actorId: actor.id,
        key,
        method: request.method,
        path: request.originalUrl.split('?')[0] ?? request.originalUrl,
        requestHash,
        status: 'IN_PROGRESS',
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (!claimed) return this.replay(actor, key, requestHash, response);
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, handler) ??
      (request.method === 'POST' ? 201 : 200);
    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(this.complete(claimed.id, status, storable(body, options.storeWithout))).pipe(
          map(() => body),
        ),
      ),
      catchError((error: unknown) =>
        from(this.release(claimed.id)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async replay(
    actor: { kind: 'STAFF' | 'CUSTOMER'; id: number },
    key: string,
    requestHash: string,
    response: Response,
  ): Promise<Observable<unknown>> {
    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorKind, actor.kind),
          eq(idempotencyKeys.actorId, actor.id),
          eq(idempotencyKeys.key, key),
        ),
      );
    if (existing && existing.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'the key was used for a different request');
    }
    if (!existing || existing.status !== 'COMPLETED' || existing.responseStatus === null) {
      throw new AppError(
        'IDEMPOTENCY_KEY_IN_PROGRESS',
        'the first request with this key is running',
      );
    }
    response.status(existing.responseStatus);
    response.setHeader('Idempotent-Replayed', 'true');
    return of(existing.responseBody);
  }

  private async complete(id: number, status: number, body: unknown): Promise<unknown> {
    await this.db
      .update(idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseStatus: status,
        responseBody: body === undefined ? null : body,
        completedAt: sql`now()`,
      })
      .where(eq(idempotencyKeys.id, id));
    return body;
  }

  private async release(id: number): Promise<void> {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  }
}
