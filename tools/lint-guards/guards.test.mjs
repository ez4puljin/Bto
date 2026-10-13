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
};
const [G1, G2, G3, G4, G5, TX] = ['G1', 'G2', 'G3', 'G4', 'G5', 'TX'];
const M = 'apps/api/src/modules';
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
  for (const guard of [G1, G2, G3, G4, G5, TX]) {
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
