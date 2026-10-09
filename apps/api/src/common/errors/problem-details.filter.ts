import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PROBLEM_CONTENT_TYPE, toProblem } from './problem-details';

/** Every error leaves the API as application/problem+json (ADR-0004). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId =
      typeof request.id === 'string' || typeof request.id === 'number'
        ? String(request.id)
        : undefined;
    const problem = toProblem(exception, {
      instance: request.originalUrl?.split('?')[0],
      ...(requestId ? { requestId } : {}),
    });
    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'request failed');
    }
    if (response.headersSent) return;
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}
