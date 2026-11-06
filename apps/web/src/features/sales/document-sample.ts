import type { DocumentOrder } from './document-view';

/** A made-up wholesale order for the document editor's preview (ADR-0143); never sent anywhere. */
export function sampleOrder(withNote: boolean): DocumentOrder {
  const line = (
    id: number,
    warehouseId: number,
    sku: string,
    name: string,
    qty: string,
    unit: string,
    base: string,
    price: string,
    total: string,
  ): DocumentOrder['lines'][number] => ({
    id,
    warehouseId,
    productSku: sku,
    productName: name,
    qty,
    unitName: unit,
    qtyApproved: base,
    baseUnitName: 'ш',
    qtyPicked: null,
    pickBinCode: `A-0${id}-1`,
    total,
    qtyDelivered: null,
    qtyBase: base,
    parts: [{ qty, uomName: unit, unitPrice: price, total }],
  });
  return {
    id: 42,
    number: '20261104_0042',
    customerName: 'Номин дэлгүүр',
    customerCode: 'Х00123',
    fulfilment: 'DELIVERY',
    deliveryDate: '2026-11-05',
    addressText: 'Мөрөн, 3-р баг, 12-р байр',
    contactName: 'Сараа',
    contactPhone: '99112233',
    paymentMethod: 'CREDIT',
    createdByName: 'Борлуулагч Бат',
    note: withNote ? 'Өглөө 10 цагаас өмнө хүргэх' : null,
    subtotal: '1286000.00',
    discountTotal: '36000.00',
    total: '1250000.00',
    lines: [
      line(
        1,
        1,
        '1001',
        'Сүү 1л (12 ширхэгтэй хайрцаг)',
        '20',
        'хайрцаг',
        '240',
        '42000.00',
        '840000.00',
      ),
      line(2, 1, '2040', 'Талх цагаан', '50', 'ш', '50', '2800.00', '140000.00'),
      line(3, 2, '3307', 'Ус ундаа 0.5л', '10', 'хайрцаг', '120', '27000.00', '270000.00'),
    ],
  };
}
