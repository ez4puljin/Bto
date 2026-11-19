import type { PrintJobView } from '../services/print-jobs.service';
import type { PrintStation } from '../services/print-stations.service';
import type { LabelItem } from '../services/till-prices.service';
import type {
  PriceLabelItemDto,
  PrintJobDto,
  PrintStationChoiceDto,
  PrintStationDto,
  WireJobStatus,
} from './printing.dto';

// Whole tugriks and whole quantities as JSON numbers: the staff app's contract (ADR-0226 #1).

export function itemDto(item: LabelItem): PriceLabelItemDto {
  return {
    productId: item.productId,
    name: item.name,
    code: item.code,
    barcodes: item.barcodes,
    unit: item.unit,
    price: item.price.toNumber(),
    bulkQty: item.bulkQty ? item.bulkQty.toNumber() : null,
    bulkPrice: item.bulkPrice ? item.bulkPrice.toNumber() : null,
  };
}

export function stationChoiceDto(station: PrintStation): PrintStationChoiceDto {
  return {
    id: station.id,
    name: station.name,
    kind: station.kind === 'BRIDGE' ? 'bridge' : 'network',
    online: station.online,
  };
}

export function stationDto(station: PrintStation): PrintStationDto {
  return {
    ...stationChoiceDto(station),
    host: station.host,
    port: station.port,
    printerName: station.printerName,
    widthDots: station.widthDots,
    status: station.status === 'ACTIVE' ? 'active' : 'disabled',
    lastSeenAt: station.lastSeenAt?.toISOString() ?? null,
    createdAt: station.createdAt.toISOString(),
  };
}

export function jobDto(job: PrintJobView): PrintJobDto {
  return {
    id: job.id,
    status: job.status.toLowerCase() as WireJobStatus,
    error: job.error,
    detail: job.detail,
    labels: job.labels,
  };
}
