import { AppError } from './common/errors/app-error';
import { ModuleRef } from '@nestjs/core';
import type { ExpiryReturnInput, ExpirySaleInput } from '@tugeel/shared/expiry';
import type { Db, Tx } from './common/db/db.types';
import {
  ExpiryCommerceModule,
  ExpiryCommerceContexts,
  ExpiryPayrollSourceAdapter,
  ExpirySalePostingAdapter,
} from './expiry-commerce.module';
import {
  EXPIRY_PAYROLL_SOURCE,
  ExpiryCommerceService,
  ExpiryPosExceptionsService,
  type ExpiryPayrollSourceInput,
} from './modules/expiry';
import { ExpiryCommerceGate } from './modules/expiry/services/expiry-commerce-gate.service';
import type { Actor } from './modules/identity';
import { PayrollSourceDeductionsService } from './modules/payroll';
import { POS_EXPIRY_OFFERS } from './modules/pos';
import { EXPIRY_SALE_POSTING } from './modules/sales';

const tx = {} as Tx;
const actor = {} as Actor;

describe('expiry synchronous composition ports', () => {
  it('binds both commerce consumers and payroll at the application boundary', () => {
    const providers = Reflect.getMetadata('providers', ExpiryCommerceModule) as unknown[];
    expect(providers).toEqual(
      expect.arrayContaining([
        { provide: EXPIRY_SALE_POSTING, useExisting: ExpirySalePostingAdapter },
        { provide: POS_EXPIRY_OFFERS, useExisting: ExpirySalePostingAdapter },
        { provide: EXPIRY_PAYROLL_SOURCE, useExisting: ExpiryPayrollSourceAdapter },
      ]),
    );
  });

  it('passes identical transaction, actor and facts to the owner and propagates rejection', async () => {
    const failure = new Error('source budget exhausted');
    const sale = { barcode: 'BTOEXP-7' } as ExpirySaleInput;
    const returned = { saleId: '9' } as ExpiryReturnInput;
    const offer = { barcode: 'BTOEXP-7' };
    const owner = {
      lockInTx: jest.fn().mockResolvedValue(undefined),
      recordSaleInTx: jest.fn().mockRejectedValue(failure),
      recordReturnInTx: jest.fn().mockResolvedValue(undefined),
      snapshots: jest.fn().mockResolvedValue([offer]),
    };
    const port = new ExpirySalePostingAdapter(
      owner as unknown as ExpiryCommerceService,
      {} as ExpiryPosExceptionsService,
    );
    await port.lockInTx(tx);
    expect(owner.lockInTx).toHaveBeenCalledWith(tx);
    await expect(port.recordSaleInTx(tx, actor, sale)).rejects.toBe(failure);
    expect(owner.recordSaleInTx).toHaveBeenCalledWith(tx, actor, sale);
    await port.recordReturnInTx(tx, actor, returned);
    expect(owner.recordReturnInTx).toHaveBeenCalledWith(tx, actor, returned);
    const db = {} as Db;
    const filter = { channel: 'RETAIL' as const, warehouseId: 3 };
    expect(await port.snapshots(db, filter)).toEqual([offer]);
    expect(owner.snapshots).toHaveBeenCalledWith(db, filter);
  });

  it('rolls back the nested POS transaction before recording a domain diagnostic on the parent', async () => {
    const domain = new AppError('NOT_FOUND');
    const nested = {} as Tx;
    const order: string[] = [];
    const transaction = {
      transaction: jest.fn(async (work: (inner: Tx) => Promise<unknown>) => {
        try {
          return await work(nested);
        } catch (error) {
          order.push('rollback');
          throw error;
        }
      }),
    } as unknown as Tx;
    const owner = { recordSaleInTx: jest.fn().mockRejectedValue(domain) };
    const diagnostics = {
      previous: jest.fn().mockResolvedValue(null),
      recordSaleInTx: jest.fn(() => {
        order.push('diagnostic');
        return Promise.resolve(domain.code);
      }),
    };
    const port = new ExpirySalePostingAdapter(
      owner as unknown as ExpiryCommerceService,
      diagnostics as unknown as ExpiryPosExceptionsService,
    );
    const sale = { sourceKind: 'POS', saleId: '1', lineId: '1' } as ExpirySaleInput;
    expect(await port.recordSaleInTx(transaction, actor, sale)).toMatchObject({
      allocated: false,
      reason: 'NOT_FOUND',
    });
    expect(order).toEqual(['rollback', 'diagnostic']);
    expect(owner.recordSaleInTx).toHaveBeenCalledWith(nested, actor, sale);
    expect(diagnostics.recordSaleInTx).toHaveBeenCalledWith(transaction, sale, domain);
    const technical = new Error('diagnostic persistence unavailable');
    diagnostics.recordSaleInTx.mockRejectedValueOnce(technical);
    await expect(port.recordSaleInTx(transaction, actor, sale)).rejects.toBe(technical);
    diagnostics.previous.mockResolvedValueOnce('NOT_FOUND');
    owner.recordSaleInTx.mockClear();
    expect(await port.recordSaleInTx(transaction, actor, sale)).toMatchObject({ allocated: false });
    expect(owner.recordSaleInTx).not.toHaveBeenCalled();
  });

  it('keeps expiry then payroll lock ordering on the same transaction', async () => {
    const order: string[] = [];
    const transaction = {
      execute: jest.fn(() => {
        order.push('expiry');
        return Promise.resolve();
      }),
    } as unknown as Tx;
    const owner = {
      lockInTx: jest.fn((received: Tx) => {
        expect(received).toBe(transaction);
        order.push('payroll');
        return Promise.resolve();
      }),
      recordInTx: jest.fn().mockResolvedValue([]),
    };
    const payroll = new ExpiryPayrollSourceAdapter(
      owner as unknown as PayrollSourceDeductionsService,
    );
    const moduleRef = { get: jest.fn().mockReturnValue(payroll) } as unknown as ModuleRef;
    await new ExpiryCommerceGate(moduleRef).lockInTx(transaction);
    expect(order).toEqual(['expiry', 'payroll']);
    expect(moduleRef.get).toHaveBeenCalledWith(EXPIRY_PAYROLL_SOURCE, { strict: false });
    const input: ExpiryPayrollSourceInput = {
      sourceKind: 'EXPIRY_SALE',
      sourceKey: 'expiry:POS:1:1:7',
      sourceReference: 'test',
      requestedMonth: null,
      allocations: [],
    };
    await payroll.recordInTx(transaction, actor, input);
    expect(owner.recordInTx).toHaveBeenCalledWith(transaction, actor, input);
    const failure = new Error('payroll closed');
    owner.recordInTx.mockRejectedValueOnce(failure);
    await expect(payroll.recordInTx(transaction, actor, input)).rejects.toBe(failure);
  });

  it('fails closed when the required payroll binding is missing', async () => {
    const failure = new Error('missing payroll port');
    const transaction = { execute: jest.fn().mockResolvedValue(undefined) } as unknown as Tx;
    const moduleRef = {
      get: jest.fn(() => {
        throw failure;
      }),
    } as unknown as ModuleRef;
    await expect(new ExpiryCommerceGate(moduleRef).lockInTx(transaction)).rejects.toBe(failure);
  });
});

describe('expiry detail selling-price contexts', () => {
  it('omits unrelated warehouses while retaining retail and applicable missing prices', async () => {
    const tills = {
      saleContexts: jest.fn().mockResolvedValue([{ id: 3, warehouseId: 30, name: 'Till' }]),
    };
    const pipelines = { saleContexts: jest.fn().mockResolvedValue([{ id: 4, name: 'Sales' }]) };
    const org = {
      warehouseNames: jest.fn().mockResolvedValue(new Map([[30, 'Shop']])),
      listWarehouses: jest.fn().mockResolvedValue([
        { id: 10, name: 'Home', status: 'ACTIVE' },
        { id: 20, name: 'Unrelated', status: 'ACTIVE' },
      ]),
    };
    const locations = { homeOf: jest.fn().mockResolvedValue(new Map([[7, 10]])) };
    const catalog = {
      get: jest.fn().mockResolvedValue({ units: [{ id: 70, isBase: true }] }),
      getMany: jest.fn().mockResolvedValue([{ baseUnit: { id: 70 } }]),
    };
    const prices = {
      quote: jest.fn().mockResolvedValue({ lines: [{ result: { priced: false } }] }),
    };
    const contexts = new ExpiryCommerceContexts(
      ...([
        tills,
        pipelines,
        org,
        catalog,
        locations,
        prices,
        {},
        {},
      ] as unknown as ConstructorParameters<typeof ExpiryCommerceContexts>),
    );
    const service = {
      db: tx,
      item: jest.fn().mockResolvedValue({ productId: 7 }),
      catalog,
      contexts: () => contexts,
    } as unknown as ExpiryCommerceService;
    const result = await ExpiryCommerceService.prototype.prices.call(service, 9);
    expect(result).toEqual({
      productUnitId: 70,
      qty: '1',
      data: [
        {
          warehouseId: 30,
          channel: 'RETAIL',
          contextId: 3,
          name: 'Till / Shop',
          unitPrice: null,
          netUnitPrice: null,
        },
        {
          warehouseId: 10,
          channel: 'WHOLESALE',
          contextId: 4,
          name: 'Sales / Home',
          unitPrice: null,
          netUnitPrice: null,
        },
      ],
    });
    expect(locations.homeOf).toHaveBeenCalledWith([7], tx);
    expect(prices.quote).toHaveBeenCalledTimes(2);
    expect((await contexts.list(tx)).map((row) => row.warehouseId)).toEqual([30, 10, 20]);
  });
});
