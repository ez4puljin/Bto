import type { BinDto, ProductLocationDto } from '../dto/bins.dto';
import type { Bin } from '../services/bins.service';
import type { ProductLocation } from '../services/product-locations.service';

export function toBinDto(bin: Bin): BinDto {
  return {
    id: bin.id,
    warehouseId: bin.warehouseId,
    code: bin.code,
    name: bin.name,
    type: bin.type,
    sellable: bin.sellable,
    status: bin.status,
    isSystem: bin.isSystem,
    pickSequence: bin.pickSequence,
    archivedAt: bin.archivedAt?.toISOString() ?? null,
  };
}

export function toLocationDto(location: ProductLocation): ProductLocationDto {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    productId: location.productId,
    isHome: location.isHome,
    defaultBinId: location.defaultBinId,
    defaultBinCode: location.defaultBinCode,
    minQty: location.minQty?.toFixed() ?? null,
    maxQty: location.maxQty?.toFixed() ?? null,
  };
}
