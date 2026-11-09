import { Controller, Headers, Sse } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { CustomerRoute } from '../../identity';
import { LiveStockHub, type LiveStockMessage, streamDuration } from '../../sales';

/**
 * «Bto300»'s live stock (ADR-0173 #4): `ready`, `stock` (`{ items: LiveStockCustomerItem[] }`,
 * the number only when the office shows numbers), `resync` and `ping`, open until the store's
 * access token expires. The values are the shop's, the same for every store. Documented in
 * OpenAPI so the isolation checks cover it; the phone reads the stream over XHR.
 */
@ApiTags('customer-app')
@Controller('customer-app/stock')
export class CustomerAppLiveStockController {
  constructor(private readonly hub: LiveStockHub) {}

  @Sse('live')
  @CustomerRoute()
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Server-sent events (ADR-0173 #4): ready, stock { items }, resync, ping; ends at the token expiry',
  })
  live(@Headers('authorization') authorization?: string): Observable<LiveStockMessage> {
    return this.hub.stream('CUSTOMER', streamDuration(authorization));
  }
}
