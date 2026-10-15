import { describe, expect, it } from 'vitest';
import {
  activeOrderFilters,
  orderFilterQuery,
  readOrderFilters,
  withoutField,
  writeOrderFilters,
} from './order-filters';

describe('order filters', () => {
  it('keep themselves in short URL keys and read back what is valid only', () => {
    const params = writeOrderFilters(new URLSearchParams('pipeline=10&view=list'), {
      customer: 9,
      deliveryFrom: '2026-10-16',
      mine: true,
      channel: 'SALES_REP',
      payment: 'CREDIT',
    });
    expect(params.toString()).toBe(
      'pipeline=10&view=list&c=9&df=2026-10-16&m=1&ch=SALES_REP&p=CREDIT',
    );
    expect(readOrderFilters(params)).toEqual({
      customer: 9,
      deliveryFrom: '2026-10-16',
      mine: true,
      channel: 'SALES_REP',
      payment: 'CREDIT',
    });
    expect(readOrderFilters(new URLSearchParams('c=x&df=16/10&m=yes&ch=PHONE&f=DELIVERY'))).toEqual(
      {
        fulfilment: 'DELIVERY',
      },
    );
  });

  it('name the active fields, drop one, and become the API query', () => {
    const filters = { deliveryTo: '2026-10-20', mine: true, fulfilment: 'PICKUP' as const };
    expect(activeOrderFilters(filters)).toEqual(['delivery', 'mine', 'fulfilment']);
    expect(withoutField(filters, 'delivery')).toEqual({ mine: true, fulfilment: 'PICKUP' });
    expect(orderFilterQuery(filters, '  номин ')).toEqual({
      q: 'номин',
      mine: true,
      fulfilment: 'PICKUP',
      deliveryTo: '2026-10-20',
    });
    expect(orderFilterQuery({}, ' ')).toEqual({});
  });
});
