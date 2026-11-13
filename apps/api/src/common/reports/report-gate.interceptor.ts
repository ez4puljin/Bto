import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { finalize, from, mergeMap, type Observable } from 'rxjs';
import { AppConfig } from '../config/app-config';
import { ReportGate } from './report-gate';

const UNGATED_KEY = 'reports:ungated';

/**
 * A route of a gated controller that takes no turn: the lists a report's filters are filled from
 * and other answers of a few milliseconds, which must open while every place is taken.
 */
export const UngatedReport = () => SetMetadata(UNGATED_KEY, true);

/** Seconds a refused screen is told to wait before it asks again. */
const RETRY_AFTER_SECONDS = 15;

/** The process's one gate, sized from the environment. */
@Injectable()
export class ReportGateService extends ReportGate {
  constructor(config: AppConfig) {
    super({
      maxRunning: config.get('REPORTS_MAX_RUNNING'),
      maxPerCaller: config.get('REPORTS_MAX_PER_USER'),
      maxWaiting: config.get('REPORTS_MAX_WAITING'),
      waitMs: config.get('REPORTS_WAIT_MS'),
    });
  }
}

/**
 * Puts a report controller behind the gate (ADR-0193): `@UseInterceptors(ReportGateInterceptor)`
 * on the class, `@UngatedReport()` on its light routes. The place is held until the handler has
 * its answer (an Excel copy is built by then) and given back whatever the outcome.
 */
@Injectable()
export class ReportGateInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ReportGate');

  constructor(
    private readonly gate: ReportGateService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.get<boolean>(UNGATED_KEY, context.getHandler())) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { auth?: { userId?: number } }>();
    const response = http.getResponse<Response>();
    const caller = request.auth?.userId === undefined ? 'anonymous' : `user:${request.auth.userId}`;

    const gone = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) gone.abort();
    };
    response.once('close', onClose);

    const turn = this.gate.enter(caller, gone.signal).catch((error: unknown) => {
      response.off('close', onClose);
      if (!gone.signal.aborted) {
        response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
        this.logger.warn({ caller, ...this.gate.snapshot() }, 'report refused: the gate is full');
      }
      throw error;
    });
    return from(turn).pipe(
      mergeMap((release) =>
        next.handle().pipe(
          finalize(() => {
            response.off('close', onClose);
            release();
          }),
        ),
      ),
    );
  }
}

/** One report route of a controller that is not all reports: the same gate, on the method. */
export const GatedReport = () => applyDecorators(UseInterceptors(ReportGateInterceptor));
