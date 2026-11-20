import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PhoneLineRequest } from '../../identity';
import { type PhoneLine, PhoneLinesService } from '../services/phone-lines.service';

interface StationRequest extends PhoneLineRequest {
  phoneStation?: PhoneLine;
}

/**
 * The station's door (ADR-0232 #3): `Authorization: Bearer bpl_<line>_<secret>` checked against
 * the line's stored hash (PHONE_KEY_INVALID, 401, otherwise) and the line marked seen. It leaves
 * the line on the request for the handler and, as a `PhoneLineActor`, for the idempotency
 * interceptor, which runs after the guards. The routes are `@Public()` for the global guard: a
 * station is not a staff member.
 */
@Injectable()
export class PhoneLineGuard implements CanActivate {
  constructor(private readonly lines: PhoneLinesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & StationRequest>();
    const header = request.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const line = await this.lines.authenticate(key);
    request.phoneStation = line;
    const requestId = (request as { id?: unknown }).id;
    request.phoneLine = {
      kind: 'PHONE_LINE',
      phoneLineId: line.id,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
    return true;
  }
}

/** The line whose key the request carried; needs `PhoneLineGuard` on the route. */
export const CurrentPhoneLine = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PhoneLine => {
    const request = context.switchToHttp().getRequest<StationRequest>();
    if (!request.phoneStation) throw new Error('@CurrentPhoneLine() needs PhoneLineGuard');
    return request.phoneStation;
  },
);
