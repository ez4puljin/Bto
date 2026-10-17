import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EDGE_DEVICE_HEADER, type EdgeCashier } from '@tugeel/shared/pos';
import type { Request } from 'express';
import { type BoundDevice, DevicesService } from '../services/devices.service';
import { KioskAuthService } from '../services/kiosk-auth.service';

/** What the kiosk guard found: the bound device and, after the PIN, its cashier. */
export interface KioskContext {
  device: BoundDevice;
  cashier: EdgeCashier | null;
}

type KioskRequest = Request & { kiosk?: KioskContext };

const ACCESS = 'edge:access';
type Access = 'public' | 'device' | 'cashier';

/** No device needed (health, pairing). */
export const EdgePublic = () => SetMetadata(ACCESS, 'public' satisfies Access);
/** A bound device, no cashier yet (its sign-in list, the PIN). */
export const DeviceOnly = () => SetMetadata(ACCESS, 'device' satisfies Access);

/**
 * The edge's only guard (ADR-0067): every route needs a bound device (`x-bto-device`) and a
 * cashier's session (`Authorization: Bearer`) unless marked otherwise. There is no staff login on
 * the edge: the till, the device and the PIN are the whole identity.
 */
@Injectable()
export class KioskGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly devices: DevicesService,
    private readonly auth: KioskAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access =
      this.reflector.getAllAndOverride<Access | undefined>(ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'cashier';
    if (access === 'public') return true;
    const request = context.switchToHttp().getRequest<KioskRequest>();
    const header = request.headers[EDGE_DEVICE_HEADER];
    const device = await this.devices.authenticate(Array.isArray(header) ? header[0] : header);
    let cashier: EdgeCashier | null = null;
    if (access === 'cashier') {
      const bearer = request.headers.authorization;
      cashier = await this.auth.verify(
        device,
        bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined,
      );
    }
    request.kiosk = { device, cashier };
    return true;
  }
}

/** The kiosk context the guard resolved. */
export const Kiosk = createParamDecorator((_: unknown, context: ExecutionContext): KioskContext => {
  const request = context.switchToHttp().getRequest<KioskRequest>();
  if (!request.kiosk) throw new Error('@Kiosk() needs KioskGuard on the route');
  return request.kiosk;
});

/** The signed-in cashier (routes that need one). */
export function cashierOf(kiosk: KioskContext): EdgeCashier {
  if (!kiosk.cashier) throw new Error('route without a cashier');
  return kiosk.cashier;
}
