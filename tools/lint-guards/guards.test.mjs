// Proves that every ESLint guard of eslint.config.mjs still fires (`pnpm lint:guards`, part of
// `pnpm check`). A guard that is deleted or weakened turns this test red. Fixture files under
// ./fixtures give eslint-plugin-boundaries real paths to resolve; the code is linted virtually.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = join(import.meta.dirname, 'fixtures');

const eslint = new ESLint({
  cwd: FIXTURES,
  overrideConfigFile: join(ROOT, 'eslint.config.mjs'),
  overrideConfig: [
    { settings: { 'boundaries/root-path': FIXTURES } },
    { ...tseslint.configs.disableTypeChecked, files: ['**/*.{ts,tsx}'] },
  ],
});

/** Guard id -> the rule that implements it and a fragment of its message (G3-G5 share a rule). */
const GUARDS = {
  G1: { ruleId: 'boundaries/dependencies', marker: '' },
  G2: { ruleId: 'no-restricted-imports', marker: 'stockLedger' },
  G3: { ruleId: 'no-restricted-syntax', marker: 'Number()/parseFloat()' },
  G4: { ruleId: 'no-restricted-syntax', marker: 'No Cyrillic in .tsx' },
  G5: { ruleId: 'no-restricted-syntax', marker: 'No literal text in JSX' },
  TX: {
    ruleId: 'no-restricted-syntax',
    marker: 'No HTTP or model call inside a database transaction',
  },
  // The Finance Core (ADR-0069 #2, #6; docs/modules/finance-core.md §3.2).
  CORE_OUT: { ruleId: 'boundaries/dependencies', marker: 'The Finance Core imports only' },
  CORE_IN: { ruleId: 'boundaries/dependencies', marker: 'reached only through' },
  FIN_LEDGER: { ruleId: 'no-restricted-imports', marker: 'fin ledger tables' },
  FIN_INTAKE: { ruleId: 'no-restricted-imports', marker: 'FinIntakeInTx is imported only' },
  FIN_CONTEXT: { ruleId: 'no-restricted-imports', marker: 'builds a FinCallContext' },
  TEST_CODE: { ruleId: 'no-restricted-imports', marker: 'never imports test code' },
  MN: { ruleId: 'no-restricted-imports', marker: '@tugeel/shared/mn imports only' },
};
const [G1, G2, G3, G4, G5, TX] = ['G1', 'G2', 'G3', 'G4', 'G5', 'TX'];
const [CORE_OUT, CORE_IN, FIN_LEDGER, FIN_INTAKE, FIN_CONTEXT, TEST_CODE, MN] = [
  'CORE_OUT',
  'CORE_IN',
  'FIN_LEDGER',
  'FIN_INTAKE',
  'FIN_CONTEXT',
  'TEST_CODE',
  'MN',
];
const M = 'apps/api/src/modules';
const FC = 'apps/api/src/finance-core';
const CORE_FILE = `${FC}/services/config.service.ts`;
const SALES_SERVICE = `${M}/sales/services/sales-orders.service.ts`;
const MN_FILE = 'packages/shared/src/mn/tax.ts';
const WEB = 'apps/web/src/features/demo/page.tsx';
const INTEGRATION = "'../../../integrations/ebarimt/client'";
const ASK_FLOW = `${M}/ai/services/ask-flow.service.ts`;
const DB_AND_LLM = `declare const db: { transaction<T>(work: () => Promise<T>): Promise<T> };
declare const llm: { complete(): Promise<string> };
`;

/** [name, guard, fixture path, code, must fire] */
const CASES = [
  // G1a module boundaries
  [
    'module internals are private',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { usersService } from '../../identity/services/users.service';\nexport const x = usersService;`,
    true,
  ],
  [
    'index.ts in the §4 direction',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { identity } from '../../identity';\nexport const x = identity;`,
    false,
  ],
  [
    'against the §4 direction',
    G1,
    `${M}/identity/services/users.service.ts`,
    `import { catalog } from '../../catalog';\nexport const x = catalog;`,
    true,
  ],
  [
    'partners -> catalog index (ADR-0032)',
    G1,
    `${M}/partners/services/customers.service.ts`,
    `import { catalog } from '../../catalog';\nexport const x = catalog;`,
    false,
  ],
  [
    'catalog -> partners stays against the direction',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { partners } from '../../partners';\nexport const x = partners;`,
    true,
  ],
  [
    'schema.ts -> schema.ts for references()',
    G1,
    `${M}/catalog/schema.ts`,
    `import { users } from '../identity/schema';\nexport const x = users;`,
    false,
  ],
  [
    'service -> another module schema.ts',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { users } from '../../identity/schema';\nexport const x = users;`,
    true,
  ],
  [
    'nobody imports reporting',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { reporting } from '../../reporting';\nexport const x = reporting;`,
    true,
  ],
  [
    'nobody imports ai (ADR-0045)',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { ai } from '../../ai';\nexport const x = ai;`,
    true,
  ],
  [
    'nobody imports segments (ADR-0049)',
    G1,
    `${M}/catalog/services/catalog.service.ts`,
    `import { segments } from '../../segments';\nexport const x = segments;`,
    true,
  ],
  [
    'pricing reaches segments only through a hook it declares (ADR-0049 #4)',
    G1,
    `${M}/pricing/services/discount-programs.service.ts`,
    `import { segments } from '../../segments';\nexport const x = segments;`,
    true,
  ],
  [
    'segments -> pricing index (the owners answer its conditions)',
    G1,
    `${M}/segments/services/segment-evaluator.ts`,
    `import { pricing } from '../../pricing';\nexport const x = pricing;`,
    false,
  ],
  [
    'ai -> identity index',
    G1,
    ASK_FLOW,
    `import { identity } from '../../identity';\nexport const x = identity;`,
    false,
  ],
  [
    'ai reads other modules only through its views',
    G1,
    ASK_FLOW,
    `import { catalog } from '../../catalog';\nexport const x = catalog;`,
    true,
  ],
  // G1b integrations
  [
    'the composition root provides an integration module',
    G1,
    'apps/api/src/app.module.ts',
    `import { LlmModule } from './integrations/llm';\nexport const x = LlmModule;`,
    false,
  ],
  [
    'the LLM client from a flow service',
    G1,
    ASK_FLOW,
    `import { LlmModule } from '../../../integrations/llm';\nexport const x = LlmModule;`,
    false,
  ],
  [
    'integration client from a service',
    G1,
    `${M}/ebarimt/services/receipts.service.ts`,
    `import { posApi } from ${INTEGRATION};\nexport const x = posApi;`,
    true,
  ],
  [
    'integration client from a job',
    G1,
    `${M}/ebarimt/jobs/issue.job.ts`,
    `import { posApi } from ${INTEGRATION};\nexport const x = posApi;`,
    false,
  ],
  [
    'integration client from a flow service',
    G1,
    `${M}/ebarimt/services/issue-flow.service.ts`,
    `import { posApi } from ${INTEGRATION};\nexport const x = posApi;`,
    false,
  ],
  [
    'integration types from anywhere',
    G1,
    `${M}/ebarimt/services/receipts.service.ts`,
    `import type { PosApiReceipt } from ${INTEGRATION};\nexport type X = PosApiReceipt;`,
    false,
  ],
  // G1c client apps
  [
    'web -> api-client',
    G1,
    WEB,
    `import { createApiClient } from '@tugeel/api-client';\nexport const x = createApiClient;`,
    false,
  ],
  [
    'web -> shared subpath',
    G1,
    WEB,
    `import { Decimal } from '@tugeel/shared/money';\nexport const x = Decimal;`,
    false,
  ],
  [
    'web -> another workspace package',
    G1,
    WEB,
    `import { print } from '@tugeel/printing';\nexport const x = print;`,
    true,
  ],
  [
    'web -> apps/api source',
    G1,
    WEB,
    `import { bootstrap } from '../../../../api/src/main';\nexport const x = bootstrap;`,
    true,
  ],
  // G2 stockLedger
  [
    'stockLedger outside the posting service',
    G2,
    `${M}/inventory/services/receipts.service.ts`,
    `import { stockLedger } from '../schema';\nexport const x = stockLedger;`,
    true,
  ],
  [
    'namespace import of a schema',
    G2,
    `${M}/inventory/services/receipts.service.ts`,
    `import * as s from '../schema';\nexport const x = s;`,
    true,
  ],
  [
    'the valuation history outside the posting service',
    G2,
    `${M}/inventory/services/receipts.service.ts`,
    `import { stockValuationAdjustments } from '../ledger.schema';
export const x = stockValuationAdjustments;`,
    true,
  ],
  [
    'the ledger through its own schema file',
    G2,
    `${M}/inventory/services/receipts.service.ts`,
    `import { stockLedger } from '../ledger.schema';
export const x = stockLedger;`,
    true,
  ],
  [
    'the posting service writes the valuation history',
    G2,
    `${M}/inventory/services/stock-posting.service.ts`,
    `import { stockValuationAdjustments } from '../ledger.schema';
export const x = stockValuationAdjustments;`,
    false,
  ],
  [
    'the posting service itself',
    G2,
    `${M}/inventory/services/stock-posting.service.ts`,
    `import { stockLedger } from '../schema';\nexport const x = stockLedger;`,
    false,
  ],
  [
    'inventory tests',
    G2,
    `${M}/inventory/__tests__/posting.spec.ts`,
    `import { stockLedger } from '../schema';\nexport const x = stockLedger;`,
    false,
  ],
  // G3 numbers
  [
    'Number()',
    G3,
    `${M}/catalog/services/catalog.service.ts`,
    'declare const v: string;\nexport const n = Number(v);',
    true,
  ],
  [
    'parseFloat()',
    G3,
    `${M}/catalog/services/catalog.service.ts`,
    'declare const v: string;\nexport const n = parseFloat(v);',
    true,
  ],
  [
    'Number.parseFloat()',
    G3,
    `${M}/catalog/services/catalog.service.ts`,
    'declare const v: string;\nexport const n = Number.parseFloat(v);',
    true,
  ],
  [
    'Number() outside modules',
    G3,
    'apps/api/src/common/env.ts',
    'export const port = Number(process.env.PORT);',
    false,
  ],
  // TX no outbound call inside a transaction callback (ADR-0045)
  [
    'fetch inside inTransaction',
    TX,
    ASK_FLOW,
    `declare function inTransaction<T>(db: unknown, work: () => Promise<T>): Promise<T>;
export const run = () => inTransaction({}, async () => (await fetch('https://example.test')).ok);`,
    true,
  ],
  [
    'a model call inside db.transaction outside modules',
    TX,
    'apps/api/src/common/env.ts',
    `${DB_AND_LLM}export const run = () => db.transaction(async () => llm.complete());`,
    true,
  ],
  [
    'this.llm inside this.db.transaction',
    TX,
    ASK_FLOW,
    `${DB_AND_LLM}export class Flow {
  private readonly db = db;
  private readonly llm = llm;
  run() {
    return this.db.transaction(() => this.llm.complete());
  }
}`,
    true,
  ],
  [
    'a model call between transactions',
    TX,
    ASK_FLOW,
    `${DB_AND_LLM}export async function run() {
  const answer = await llm.complete();
  return db.transaction(() => Promise.resolve(answer));
}`,
    false,
  ],
  [
    'Number() stays banned next to TX in modules',
    G3,
    ASK_FLOW,
    'declare const v: string;\nexport const n = Number(v);',
    true,
  ],
  // The Finance Core imports only its whitelist (ADR-0069 #2); the exit case of P0b first.
  [
    'the core never imports a module (modules/sales)',
    CORE_OUT,
    CORE_FILE,
    `import { sales } from '../../modules/sales';\nexport const x = sales;`,
    true,
  ],
  [
    'the core never imports the edge',
    CORE_OUT,
    CORE_FILE,
    `import { EDGE_DB } from '../../edge/db/edge-db';\nexport const x = EDGE_DB;`,
    true,
  ],
  [
    'the core never imports the aggregated schema',
    CORE_OUT,
    CORE_FILE,
    `import { schema } from '../../db/schema';\nexport const x = schema;`,
    true,
  ],
  [
    'the core never imports common/config',
    CORE_OUT,
    CORE_FILE,
    `import { AppConfig } from '../../common/config/app-config';\nexport const x = AppConfig;`,
    true,
  ],
  [
    'the core never imports common/segments',
    CORE_OUT,
    CORE_FILE,
    `import { SegmentDefinitionDto } from '../../common/segments/segment-definition.dto';
export const x = SegmentDefinitionDto;`,
    true,
  ],
  [
    "the core never imports Bto's Tx, not even as a type",
    CORE_OUT,
    CORE_FILE,
    `import type { Tx } from '../../common/db/db.types';\nexport type X = Tx;`,
    true,
  ],
  [
    'the core never imports an integration',
    CORE_OUT,
    CORE_FILE,
    `import { LlmModule } from '../../integrations/llm';\nexport const x = LlmModule;`,
    true,
  ],
  [
    'the core never imports the shared root',
    CORE_OUT,
    CORE_FILE,
    `import { Decimal } from '@tugeel/shared';\nexport const x = Decimal;`,
    true,
  ],
  [
    'the core never imports another shared subpath',
    CORE_OUT,
    CORE_FILE,
    `import { salesNumber } from '@tugeel/shared/sales';\nexport const x = salesNumber;`,
    true,
  ],
  [
    'the core imports a whitelisted platform file',
    CORE_OUT,
    CORE_FILE,
    `import { anyTx } from '../../common/db/any-tx';\nexport const x = anyTx;`,
    false,
  ],
  [
    'the core imports @tugeel/shared/money',
    CORE_OUT,
    CORE_FILE,
    `import { Decimal } from '@tugeel/shared/money';\nexport const x = Decimal;`,
    false,
  ],
  [
    'the core imports @tugeel/fin-contract',
    CORE_OUT,
    CORE_FILE,
    `import { FIN_ERROR_CODES } from '@tugeel/fin-contract';\nexport const x = FIN_ERROR_CODES;`,
    false,
  ],
  [
    'the core imports npm packages',
    CORE_OUT,
    CORE_FILE,
    `import { sql } from 'drizzle-orm';\nexport const x = sql;`,
    false,
  ],
  [
    'the core imports its own files',
    CORE_OUT,
    CORE_FILE,
    `import { postingService } from '../posting/posting.service';\nexport const x = postingService;`,
    false,
  ],
  [
    'inside the core nothing is private',
    CORE_IN,
    CORE_FILE,
    `import { postingService } from '../posting/posting.service';\nexport const x = postingService;`,
    false,
  ],
  // ... and is reached only through its index.ts (ADR-0069 #2)
  [
    'a module never imports the core internals',
    CORE_IN,
    SALES_SERVICE,
    `import { postingService } from '../../../finance-core/posting/posting.service';
export const x = postingService;`,
    true,
  ],
  [
    'a module never imports the core schema',
    CORE_IN,
    SALES_SERVICE,
    `import { finBranches } from '../../../finance-core/schema';\nexport const x = finBranches;`,
    true,
  ],
  [
    'a module imports the core index',
    CORE_IN,
    SALES_SERVICE,
    `import { FinanceCoreModule } from '../../../finance-core';\nexport const x = FinanceCoreModule;`,
    false,
  ],
  [
    'the web never imports the core, not even its index',
    G1,
    WEB,
    `import { FinanceCoreModule } from '../../../../api/src/finance-core';
export const x = FinanceCoreModule;`,
    true,
  ],
  [
    'an integration client never imports the core',
    G1,
    'apps/api/src/integrations/llm/index.ts',
    `import { FinanceCoreModule } from '../../finance-core';\nexport const x = FinanceCoreModule;`,
    true,
  ],
  [
    'the composition root imports the core index',
    CORE_IN,
    'apps/api/src/app.module.ts',
    `import { FinanceCoreModule } from './finance-core';\nexport const x = FinanceCoreModule;`,
    false,
  ],
  [
    'the aggregated schema lists the core tables',
    CORE_IN,
    'apps/api/src/db/schema.ts',
    `import { finBranches } from '../finance-core/schema';\nexport const x = finBranches;`,
    false,
  ],
  [
    'a test reads the core schema',
    CORE_IN,
    'apps/api/test/integration/fin.int-spec.ts',
    `import { finBranches } from '../../src/finance-core/schema';\nexport const x = finBranches;`,
    false,
  ],
  // the fin ledger tables only from finance-core/posting/** (§3.1 rule 9)
  [
    'a core service never imports a ledger table',
    FIN_LEDGER,
    CORE_FILE,
    `import { finDocuments } from '../schema';\nexport const x = finDocuments;`,
    true,
  ],
  [
    'a test never imports a ledger table',
    FIN_LEDGER,
    'apps/api/test/integration/fin.int-spec.ts',
    `import { finJournalLines } from '../../src/finance-core/schema';\nexport const x = finJournalLines;`,
    true,
  ],
  [
    'the posting code imports the ledger tables',
    FIN_LEDGER,
    `${FC}/posting/posting.service.ts`,
    `import { finDocuments, finJournalLines } from '../schema';
export const x = [finDocuments, finJournalLines];`,
    false,
  ],
  [
    'stockLedger stays banned in the posting code',
    G2,
    `${FC}/posting/posting.service.ts`,
    `import { stockLedger } from '../../modules/inventory/schema';\nexport const x = stockLedger;`,
    true,
  ],
  [
    'fin ledger tables stay banned in the stock-posting service',
    FIN_LEDGER,
    `${M}/inventory/services/stock-posting.service.ts`,
    `import { finDocuments } from '../../../finance-core/schema';\nexport const x = finDocuments;`,
    true,
  ],
  // FinIntakeInTx and the call-context factory (§3.1 rule 8)
  [
    'sales never posts inside its transaction itself',
    FIN_INTAKE,
    SALES_SERVICE,
    `import { FinIntakeInTx } from '../../../finance-core';\nexport const x = FinIntakeInTx;`,
    true,
  ],
  [
    'pos posts through FinIntakeInTx',
    FIN_INTAKE,
    `${M}/pos/services/pos-shifts.service.ts`,
    `import { FinIntakeInTx } from '../../../finance-core';\nexport const x = FinIntakeInTx;`,
    false,
  ],
  [
    'pos never builds a call context',
    FIN_CONTEXT,
    `${M}/pos/services/pos-shifts.service.ts`,
    `import { createFinCallContext } from '../../../finance-core';
export const x = createFinCallContext;`,
    true,
  ],
  [
    'fin-bridge builds the call contexts',
    FIN_CONTEXT,
    `${M}/fin-bridge/services/contexts.service.ts`,
    `import { createFinCallContext, FinIntakeInTx } from '../../../finance-core';
export const x = [createFinCallContext, FinIntakeInTx];`,
    false,
  ],
  // StaticCaller and the harness stay in apps/api/test (ADR-0076)
  [
    'src never imports test code',
    TEST_CODE,
    `${M}/pos/services/pos-shifts.service.ts`,
    `import { StaticCaller } from '../../../../test/harness/static-caller';
export const x = StaticCaller;`,
    true,
  ],
  [
    'tests import the harness',
    TEST_CODE,
    'apps/api/test/integration/fin.int-spec.ts',
    `import { StaticCaller } from '../harness/static-caller';\nexport const x = StaticCaller;`,
    false,
  ],
  // G3 and TX cover the core (ADR-0069 #6)
  [
    'Number() in the core',
    G3,
    CORE_FILE,
    'declare const v: string;\nexport const n = Number(v);',
    true,
  ],
  [
    'fetch inside a transaction in the core',
    TX,
    CORE_FILE,
    `declare function inTransaction<T>(db: unknown, work: () => Promise<T>): Promise<T>;
export const run = () => inTransaction({}, async () => (await fetch('https://example.test')).ok);`,
    true,
  ],
  // @tugeel/shared/mn stands on money, time and taxpayer (ADR-0074 #2)
  [
    'mn never imports shared/finance',
    MN,
    MN_FILE,
    `import { finance } from '../finance';\nexport const x = finance;`,
    true,
  ],
  [
    'mn never imports a package',
    MN,
    MN_FILE,
    `import { Decimal } from 'decimal.js';\nexport const x = Decimal;`,
    true,
  ],
  [
    'mn imports money',
    MN,
    MN_FILE,
    `import { Decimal } from '../money';\nexport const x = Decimal;`,
    false,
  ],
  // G6 inline disable comments are ignored
  [
    'eslint-disable comments are ignored',
    G3,
    `${M}/catalog/services/catalog.service.ts`,
    'declare const v: string;\n// eslint-disable-next-line no-restricted-syntax\nexport const n = Number(v);',
    true,
  ],
  // G4 Cyrillic in .tsx
  ['Cyrillic string literal', G4, WEB, "export const label = 'Сайн';", true],
  [
    'Cyrillic template literal',
    G4,
    WEB,
    'declare const x: string;\nexport const label = `Төв ${x}`;',
    true,
  ],
  ['Latin identifiers and codes', G4, WEB, "export const variant = 'outline';", false],
  [
    'tests may use Cyrillic strings',
    G4,
    'apps/web/src/features/demo/page.test.tsx',
    "export const label = 'Сайн';",
    false,
  ],
  ['Cyrillic JSX text', G5, WEB, 'export const P = () => <p>Үнэ</p>;', true],
  [
    'tests may use Cyrillic',
    G5,
    'apps/web/src/features/demo/page.test.tsx',
    'export const P = () => <p>Үнэ</p>;',
    false,
  ],
  // G5 literal JSX text
  [
    'literal JSX text in a concise arrow',
    G5,
    WEB,
    'export const P = () => <p>Hello world</p>;',
    true,
  ],
  [
    'literal JSX text in a function',
    G5,
    WEB,
    'export function P() {\n  return <div>Save order</div>;\n}',
    true,
  ],
  [
    'punctuation and numbers only',
    G5,
    WEB,
    "declare const t: (key: string) => string;\nexport const P = () => <p>{t('a')} · 12:30 — %</p>;",
    false,
  ],
  [
    'translated JSX text',
    G5,
    WEB,
    "declare const t: (key: string) => string;\nexport const P = () => <p>{t('orders.title')}</p>;",
    false,
  ],
];

for (const [name, guard, file, code, mustFire] of CASES) {
  test(name, async () => {
    const filePath = join(FIXTURES, file);
    assert.ok(existsSync(filePath), `missing fixture ${file}`);
    assert.equal(await eslint.isPathIgnored(filePath), false, `${file} is ignored by the config`);
    const [result] = await eslint.lintText(code, { filePath });
    assert.deepEqual(
      result.messages.filter((message) => message.fatal),
      [],
      'the fixture code must parse',
    );
    const { ruleId, marker } = GUARDS[guard];
    const fired = result.messages.some(
      (message) =>
        message.ruleId === ruleId && message.severity === 2 && message.message.includes(marker),
    );
    assert.equal(fired, mustFire, `${name}: ${JSON.stringify(result.messages, null, 2)}`);
  });
}

test('every guard keeps a firing and a non-firing case', () => {
  for (const guard of Object.keys(GUARDS)) {
    assert.ok(
      CASES.some((c) => c[1] === guard && c[4]),
      `${guard} has no firing case`,
    );
    assert.ok(
      CASES.some((c) => c[1] === guard && !c[4]),
      `${guard} has no non-firing case`,
    );
  }
});

test('no nested ESLint or Prettier config can shadow the root one', () => {
  const forbidden =
    /^(eslint\.config\.[cm]?[jt]s|\.eslintrc.*|\.prettierrc.*|prettier\.config\.[cm]?[jt]s)$/;
  const directories = ['scripts', 'tools'];
  for (const group of ['apps', 'packages']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(`${group}/${entry.name}`);
    }
  }
  const found = directories.flatMap((directory) =>
    existsSync(join(ROOT, directory))
      ? readdirSync(join(ROOT, directory))
          .filter((file) => forbidden.test(file))
          .map((file) => `${directory}/${file}`)
      : [],
  );
  assert.deepEqual(found, []);
});
