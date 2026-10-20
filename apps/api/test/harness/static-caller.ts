import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { FinPermission } from '@tugeel/fin-contract';
import { Pool } from 'pg';
import { DB_POOL } from '../../src/common/db/db.tokens';
import {
  createFinCallContext,
  ensureDefaultChart,
  ensureDefaultCompany,
  FIN_DB,
  type FinCallContext,
  type FinChartTemplateAccount,
  FinanceCoreModule,
  type FinDb,
  type FinInstallationSpec,
  STATIC_CALLER_MARK,
} from '../../src/finance-core';

/**
 * The test StaticCaller (ADR-0076 #2, ADR-0084 #4): builds Finance Core call contexts and runs the
 * installation step without any Bto module, so the core is proven on its own (a stand-in for a
 * second source system, e.g. the PMS). ESLint lets only this test file call `createFinCallContext`;
 * loading it marks the process, and a production process with the mark refuses to start.
 */
(globalThis as Record<symbol, unknown>)[STATIC_CALLER_MARK] = true;

export const TEST_TENANT = 'TEST_T';
export const TEST_COMPANY = 'TST';
export const TEST_SOURCE = 'TEST_PMS';

export const TEST_SPEC: FinInstallationSpec = {
  tenant: { code: TEST_TENANT, name: 'Туршилтын групп' },
  company: {
    code: TEST_COMPANY,
    legalName: 'Туршилтын ХХК',
    timezone: 'Asia/Ulaanbaatar',
    functionalCurrency: 'MNT',
  },
  sources: [
    { code: TEST_SOURCE, linkTemplate: null },
    { code: 'FIN', linkTemplate: null },
  ],
  postingKeys: [
    { code: 'AR', requiredControl: 'RECEIVABLE', requiresTaxCode: false },
    { code: 'VAT_OUTPUT', requiredControl: 'NONE', requiresTaxCode: true },
    { code: 'CLEARING', requiredControl: 'NONE', requiresTaxCode: false },
    { code: 'CASH', requiredControl: 'MONEY', requiresTaxCode: false },
    { code: 'SALES', requiredControl: 'NONE', requiresTaxCode: false },
    { code: 'AP', requiredControl: 'PAYABLE', requiresTaxCode: false },
    { code: 'MANUAL', requiredControl: 'NONE', requiresTaxCode: false },
  ],
  numberSeries: [
    { code: 'PAYMENT', pattern: 'R-{year}{month}{day}-', digits: 4 },
    { code: 'JOURNAL', pattern: 'J-{year}{month}{day}-', digits: 4 },
    { code: 'ALLOCATION', pattern: 'A-{year}{month}{day}-', digits: 4 },
  ],
  documentTypes: [
    {
      code: 'TEST.INVOICE',
      system: TEST_SOURCE,
      class: 'AR_INVOICE',
      numberMode: 'SOURCE',
      numberSeries: null,
    },
    {
      code: 'TEST.CREDIT',
      system: TEST_SOURCE,
      class: 'AR_CREDIT',
      numberMode: 'SOURCE',
      numberSeries: null,
    },
    {
      code: 'TEST.RECEIPT',
      system: TEST_SOURCE,
      class: 'RECEIPT',
      numberMode: 'CORE',
      numberSeries: 'PAYMENT',
    },
    {
      code: 'TEST.REFUND',
      system: TEST_SOURCE,
      class: 'PAYMENT',
      numberMode: 'CORE',
      numberSeries: 'PAYMENT',
    },
    {
      code: 'TEST.BILL',
      system: TEST_SOURCE,
      class: 'AP_BILL',
      numberMode: 'SOURCE',
      numberSeries: null,
    },
    {
      code: 'TEST.BILL_CREDIT',
      system: TEST_SOURCE,
      class: 'AP_CREDIT',
      numberMode: 'SOURCE',
      numberSeries: null,
    },
    {
      code: 'TEST.SUPPLIER_PAYMENT',
      system: TEST_SOURCE,
      class: 'PAYMENT',
      numberMode: 'CORE',
      numberSeries: 'PAYMENT',
    },
    {
      code: 'TEST.JOURNAL',
      system: TEST_SOURCE,
      class: 'JOURNAL',
      numberMode: 'CORE',
      numberSeries: 'JOURNAL',
    },
    {
      code: 'FIN.JOURNAL',
      system: 'FIN',
      class: 'JOURNAL',
      numberMode: 'CORE',
      numberSeries: 'JOURNAL',
    },
    {
      code: 'FIN.RECEIPT',
      system: 'FIN',
      class: 'RECEIPT',
      numberMode: 'CORE',
      numberSeries: 'PAYMENT',
    },
    {
      code: 'FIN.ALLOCATION',
      system: 'FIN',
      class: 'ALLOCATION',
      numberMode: 'CORE',
      numberSeries: 'ALLOCATION',
    },
  ],
  legacyParty: { system: 'FIN', ref: 'LEGACY_UNASSIGNED', name: 'LEGACY_UNASSIGNED' },
  branches: [{ system: TEST_SOURCE, externalId: '1', code: 'MAIN', name: 'Төв', active: true }],
};

export const StaticCaller = {
  source(system: string = TEST_SOURCE, tenant: string = TEST_TENANT): FinCallContext {
    return createFinCallContext({
      principal: { kind: 'SOURCE', tenant, system },
      actor: { kind: 'SOURCE', ref: `test:${system}`, label: system },
    });
  },

  user(
    permissions: Record<string, FinPermission[]>,
    tenant: string = TEST_TENANT,
    ref = 'test-user',
  ): FinCallContext {
    return createFinCallContext({
      principal: { kind: 'USER', tenant, ref },
      permissions,
      actor: { kind: 'STAFF', ref, label: 'Тест хэрэглэгч' },
    });
  },

  ensure(db: FinDb, spec: FinInstallationSpec = TEST_SPEC) {
    return db.transaction((tx) => ensureDefaultCompany(tx, spec));
  },

  /** The installation step and the test chart (F1's ledger, ADR-0089). */
  ensureWithChart(db: FinDb, spec: FinInstallationSpec = TEST_SPEC) {
    return db.transaction(async (tx) => {
      const scope = await ensureDefaultCompany(tx, spec);
      await ensureDefaultChart(tx, scope, TEST_CHART);
      return scope;
    });
  },
};

/**
 * A small chart: a cash box, a receivable, a clearing account, a payable and a tax account mapped by
 * key, and a sales account.
 */
export const TEST_CHART: FinChartTemplateAccount[] = [
  { code: '1001', name: 'Касс', kind: 'ASSET', normalSide: 'DEBIT', control: 'MONEY', key: 'CASH' },
  {
    code: '1201',
    name: 'Авлага',
    kind: 'ASSET',
    normalSide: 'DEBIT',
    control: 'RECEIVABLE',
    key: 'AR',
  },
  {
    code: '1301',
    name: 'Түр данс',
    kind: 'ASSET',
    normalSide: 'DEBIT',
    control: 'NONE',
    key: 'CLEARING',
  },
  {
    code: '3101',
    name: 'Өглөг',
    kind: 'LIABILITY',
    normalSide: 'CREDIT',
    control: 'PAYABLE',
    key: 'AP',
  },
  {
    code: '3110',
    name: 'НӨАТ',
    kind: 'LIABILITY',
    normalSide: 'CREDIT',
    control: 'NONE',
    key: 'VAT_OUTPUT',
  },
  {
    code: '5101',
    name: 'Орлого',
    kind: 'INCOME',
    normalSide: 'CREDIT',
    control: 'NONE',
    key: 'SALES',
  },
];

/** The core alone over this worker's test database: no AppModule, no Bto module. */
export async function createFinanceCoreOnly(): Promise<{
  module: TestingModule;
  db: FinDb;
  close: () => Promise<void>;
}> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  @Global()
  @Module({ providers: [{ provide: DB_POOL, useValue: pool }], exports: [DB_POOL] })
  class PoolOnly {}
  const module = await Test.createTestingModule({
    imports: [PoolOnly, FinanceCoreModule],
  }).compile();
  await module.init();
  return {
    module,
    db: module.get<FinDb>(FIN_DB),
    close: async () => {
      await module.close();
      await pool.end();
    },
  };
}
