import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import type { ExpiryCommerceView } from '@tugeel/shared/expiry';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { idempotency } from './catalog';
import { bearer } from './identity';
import { costReceiptAsTyped, inventoryApi, postReceipt } from './inventory';
import { partnersApi } from './partners';

/** Creates honest posted/costed provenance and an approved label through production HTTP paths. */
export async function approveExpiry(
  app: NestExpressApplication,
  token: string,
  input: {
    productId: number;
    productUnitId: number;
    receiptWarehouseId: number;
    warehouseId: number;
    channel: 'RETAIL' | 'WHOLESALE';
    contextId: number;
    liableUserIds: number[];
    qty?: string;
    costAmount?: string;
    unitPrice?: string;
    payrollMonth?: string;
    freeGoods?: boolean;
    purchaseDiscount?: string;
  },
): Promise<{
  commerce: ExpiryCommerceView;
  itemId: number;
  receiptId: number;
  receiptLineId: number;
}> {
  const http = () => request(app.getHttpServer());
  const supplierCode = randomBytes(8).readBigUInt64BE().toString();
  const supplier = await partnersApi(app, token).supplier({
    code: supplierCode,
    name: `Synthetic expiry supplier ${supplierCode}`,
    vatPayer: false,
  });
  await inventoryApi(app, token).setHome(input.productId, input.receiptWarehouseId);
  const qty = input.qty ?? '10';
  const receipt = (
    await http()
      .post('/api/v1/receipts')
      .set(bearer(token))
      .set(idempotency())
      .send({
        supplierId: supplier.id,
        lines: [
          {
            productUnitId: input.productUnitId,
            enteredQty: qty,
            ...(input.freeGoods ? { freeGoods: true } : { docAmount: input.costAmount ?? '1000' }),
          },
        ],
      })
      .expect(201)
  ).body as { id: number; lines: { id: number }[] };
  if (input.purchaseDiscount)
    await http()
      .put(`/api/v1/receipts/${receipt.id}/discounts`)
      .set(bearer(token))
      .send({ discounts: [{ kind: 'NOTE', amount: input.purchaseDiscount }] })
      .expect(200);
  await postReceipt(app, token, receipt.id);
  await costReceiptAsTyped(app, token, receipt.id);
  const line = receipt.lines[0];
  if (!line) throw new Error('receipt source missing');
  const item = (
    await http()
      .post('/api/v1/expiry/items')
      .set(bearer(token))
      .set(idempotency())
      .send({
        productId: input.productId,
        expiryDate: addDays(businessDate(), 5),
        qtyFloor: qty,
        qtyWarehouse: '0',
        allowDuplicate: true,
      })
      .expect(201)
  ).body as { id: number; editVersion: number };
  if (input.liableUserIds.length)
    await http()
      .put(`/api/v1/expiry/items/${item.id}/liability`)
      .set(bearer(token))
      .send({ type: 'SPECIFIC', roleIds: [], userIds: input.liableUserIds })
      .expect(200);
  const sourceCommerce = (
    await http()
      .put(`/api/v1/expiry/items/${item.id}/source`)
      .set(bearer(token))
      .send({ expectedVersion: 0, receiptLineId: line.id, qtyBase: qty })
      .expect(200)
  ).body as ExpiryCommerceView;
  const commerce = (
    await http()
      .post(`/api/v1/expiry/items/${item.id}/markdowns`)
      .set(bearer(token))
      .set(idempotency())
      .send({
        expectedVersion: item.editVersion,
        expectedSourceVersion: sourceCommerce.sourceVersion,
        expectedCostingVersion: sourceCommerce.source?.current?.version ?? 0,
        expectedLiabilityFingerprint: sourceCommerce.liabilityFingerprint,
        receiptLineId: line.id,
        qtyBase: qty,
        warehouseId: input.warehouseId,
        channel: input.channel,
        contextId: input.contextId,
        unitPrice: input.unitPrice ?? '50',
        payrollMonth: input.payrollMonth ?? businessDate().slice(0, 7),
      })
      .expect(201)
  ).body as ExpiryCommerceView;
  return { commerce, itemId: item.id, receiptId: receipt.id, receiptLineId: line.id };
}
