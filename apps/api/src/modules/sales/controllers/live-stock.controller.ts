import { Controller, Headers, Sse } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { RequirePermission } from '../../identity';
import { LiveStockHub, type LiveStockMessage, streamDuration } from '../services/live-stock.hub';
import { REP } from '../services/rep-access';

/**
 * The staff app's live stock (ADR-0173 #4): a server-sent event stream of `ready`, `stock`
 * (`{ items: LiveStockStaffItem[] }`), `resync` and `ping`, open until the access token expires.
 * Documented in OpenAPI so the isolation checks cover it; the phone reads the stream over XHR.
 */
@ApiTags('sales')
@Controller('sales-rep/stock')
export class SalesRepLiveStockController {
  constructor(private readonly hub: LiveStockHub) {}

  @Sse('live')
  @RequirePermission(REP)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Server-sent events (ADR-0173 #4): ready, stock { items }, resync, ping; ends at the token expiry',
  })
  live(@Headers('authorization') authorization?: string): Observable<LiveStockMessage> {
    return this.hub.stream('STAFF', streamDuration(authorization));
  }
}
