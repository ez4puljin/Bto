import type { Request } from 'express';
import { AppError } from '../../../common/errors/app-error';

/**
 * Native clients only (ADR-0061 #4): a browser always sends `Origin`, so a script on the admin's
 * origin can never obtain a refresh token it could read; the web keeps its cookie routes.
 */
export function assertNativeClient(request: Request): void {
  if (request.headers.origin !== undefined) {
    throw new AppError('FORBIDDEN', 'a browser request to a native-client route', {
      reason: 'ORIGIN',
    });
  }
}
