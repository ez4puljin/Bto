// The only ESLint config of the repository. `pnpm lint` passes --config so a nested eslint.config.*
// (from `nest new`, create-vite, shadcn) can never replace these rules. tools/lint-guards/guards.test.mjs
// proves that each guard fires (`pnpm lint:guards`, part of `pnpm check`).
//
// GUARDS (docs/architecture.md §3.1 and §12) — never delete or weaken them:
//   G1 boundaries/dependencies       module boundaries, integrations, client apps, packages
//   G2 no-restricted-imports         stockLedger is written only by the stock-posting service
//   G3 no-restricted-syntax          no Number()/parseFloat() in apps/api/src/modules/** (ADR-0010)
//   G4 no-restricted-syntax          no Cyrillic literals or JSX text in .tsx (ADR-0011)
//   G5 no-restricted-syntax          no literal text in JSX (any letter) in .tsx (ADR-0011)
//   G6 linterOptions.noInlineConfig  eslint-disable comments are ignored: exceptions live in this file
//   TX no-restricted-syntax          no fetch/axios/LLM call inside a transaction callback (ADR-0045)
// Flat config REPLACES a rule's options when a later object sets the same rule for the same file, so
// no-restricted-syntax and no-restricted-imports are each set once per file group: TX_GUARD has its
// own apps/api/src/** object and is spread into the G3 object, which wins for module files.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = import.meta.dirname; // never process.cwd(): boundaries compares paths case-sensitively
const TS = ['**/*.{ts,tsx,mts,cts}'];
const JS = ['**/*.{js,mjs,cjs}'];
const TESTS = [
  '**/*.{spec,test}.{ts,tsx}',
  '**/*.int-spec.ts',
  '**/__tests__/**/*.{ts,tsx}',
  'apps/api/test/**/*.ts',
  'apps/web/src/test/**/*.{ts,tsx}',
];

/** docs/architecture.md §4 "Depends on" (edit together with §4). identity is the graph root. */
const MODULE_DEPS = {
  identity: [],
  catalog: ['identity'],
  partners: ['identity', 'catalog'], // ADR-0032: product_suppliers
  inventory: ['identity', 'catalog', 'partners'],
  imports: ['identity', 'catalog', 'partners', 'inventory', 'pricing'],
  pricing: ['identity', 'catalog', 'partners'],
  sales: ['identity', 'catalog', 'partners', 'pricing', 'inventory', 'ebarimt'],
  // ADR-0060: sales only for its hook tokens and snapshot types; finance never reads a sales table.
  finance: ['identity', 'catalog', 'partners', 'inventory', 'sales', 'ebarimt'],
  ebarimt: ['identity', 'catalog'],
  delivery: ['identity', 'partners', 'sales', 'inventory', 'finance', 'notifications'],
  procurement: ['identity', 'partners', 'catalog', 'inventory', 'finance'],
  notifications: ['identity', 'partners'],
  hr: ['identity'],
  reporting: ['identity'], // plus every schema.ts (rule 4); nobody imports reporting
  ai: ['identity'], // other modules' data only through its views in schema ai (ADR-0045); nobody imports ai
  // ADR-0049: evaluates segments through the owners' index.ts; nobody imports segments (hooks reach it)
  segments: ['identity', 'catalog', 'partners', 'inventory', 'pricing'],
};
const MOD = { type: 'api-module' };
const INT = { type: 'api-integration' };
const CLIENT_APP = { type: 'app', captured: { app: ['web', 'mobile'] } };

// Policies are evaluated in order; the last matching policy decides.
const POLICIES = [
  // G1a §3.1 rule 1: modules talk through index.ts, in the §4 direction only.
  {
    from: { element: MOD },
    disallow: { to: { element: MOD } },
    message:
      'modules/{{from.element.captured.module}} -> modules/{{to.element.captured.module}}: only through its index.ts (schema.ts -> schema.ts for references()), and only in the docs/architecture.md §4 direction (§3.1 rule 1).',
  },
  ...Object.entries(MODULE_DEPS)
    .filter(([, deps]) => deps.length)
    .flatMap(([module, deps]) => [
      {
        from: { element: { ...MOD, captured: { module } } },
        allow: {
          to: { element: { ...MOD, captured: { module: deps }, fileInternalPath: 'index.ts' } },
        },
      },
      {
        from: { element: { ...MOD, captured: { module }, fileInternalPath: 'schema.ts' } },
        allow: {
          to: { element: { ...MOD, captured: { module: deps }, fileInternalPath: 'schema.ts' } },
        },
      },
    ]),
  {
    from: { element: { ...MOD, captured: { module: 'reporting' } } },
    allow: { to: { element: { ...MOD, fileInternalPath: 'schema.ts' } } },
  },
  {
    from: { file: { categories: 'test' } },
    allow: { to: { element: { ...MOD, fileInternalPath: ['index.ts', 'schema.ts'] } } },
  },
  {
    from: { element: MOD },
    disallow: { to: { element: { ...MOD, captured: { module: 'reporting' } } } },
    message: 'Nothing imports the reporting module (§3.1 rule 4).',
  },
  {
    from: { element: MOD },
    disallow: { to: { element: { ...MOD, captured: { module: 'ai' } } } },
    message: 'Nothing imports the ai module (§3.1 rule 4, ADR-0045).',
  },
  {
    from: { element: MOD },
    disallow: { to: { element: { ...MOD, captured: { module: 'segments' } } } },
    message:
      'Nothing imports the segments module: declare a resolver hook and let segments bind it (ADR-0049 #4).',
  },
  // G1b §3.1 rule 6: integration clients only from jobs and flow services (ADR-0002 #8).
  {
    disallow: { to: { element: INT } },
    message:
      'src/integrations/** is imported only by jobs/*.job.ts and *-flow.service.ts (§3.1 rule 6, ADR-0002 #8).',
  },
  {
    from: { file: { categories: ['job', 'flow-service', 'composition-root', 'test'] } },
    allow: { to: { element: INT } },
  },
  { from: { element: INT }, allow: { to: { element: INT } } },
  { allow: { to: { element: INT }, dependency: { kind: ['type', 'typeof'] } } },
  {
    from: { element: INT },
    disallow: { to: { element: MOD } },
    message: 'Integration clients never import modules.',
  },
  // G1c §3.1 rule 3: client apps use only the generated API client and the shared package.
  {
    from: { element: CLIENT_APP },
    disallow: {
      to: [
        { module: { source: '@tugeel/*' } },
        { element: { type: ['app', 'api-module', 'api-integration', 'package'] } },
      ],
    },
    message:
      'apps/{{from.element.captured.app}} imports only @tugeel/api-client and @tugeel/shared from this repository (§3.1 rule 3).',
  },
  {
    from: { element: CLIENT_APP },
    allow: {
      to: { module: { source: ['@tugeel/api-client', '@tugeel/shared', '@tugeel/shared/*'] } },
    },
  },
  // G1d: shared packages never depend on application code.
  {
    from: { element: { type: 'package' } },
    disallow: { to: { element: { type: ['app', 'api-module', 'api-integration'] } } },
    message: 'packages/* never import application code.',
  },
];

const NUMERIC_MESSAGE =
  'NUMERIC values never go through Number()/parseFloat(): use Decimal from @tugeel/shared/money (§12, ADR-0010).';
const NUMBER_PARSE_BAN = [
  {
    selector: "CallExpression[callee.type='Identifier'][callee.name=/^(Number|parseFloat)$/]",
    message: NUMERIC_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(Number|globalThis|window)$/][callee.property.name=/^(Number|parseFloat)$/]",
    message: NUMERIC_MESSAGE,
  },
  { selector: "NewExpression[callee.name='Number']", message: NUMERIC_MESSAGE },
];
// TX (§3.1 rule 6, ADR-0045): a transaction holds locks and a pooled connection, so the network waits
// outside it. Matches calls lexically inside inTransaction(...) / <anything>.transaction(...).
const TRANSACTION_CALL =
  ":matches(CallExpression[callee.name='inTransaction'], CallExpression[callee.property.name='transaction'])";
const OUTBOUND_CALL = [
  'CallExpression[callee.name=/^(fetch|axios)$/]',
  "CallExpression[callee.object.name='axios']",
  'CallExpression[callee.object.name=/^llm/]',
  'CallExpression[callee.object.property.name=/^llm/]',
].join(', ');
const TX_GUARD = [
  {
    selector: `${TRANSACTION_CALL} :matches(${OUTBOUND_CALL})`,
    message:
      'No HTTP or model call inside a database transaction: make it between transactions, in a *-flow.service.ts or a job (§3.1 rule 6, ADR-0045).',
  },
];
const CYRILLIC = '/[\\u0400-\\u04FF]/';
const CYRILLIC_MESSAGE =
  'No Cyrillic in .tsx: add a key to packages/shared/i18n/mn.json and render t(key) (ADR-0011).';
const CYRILLIC_BAN = [
  { selector: `Literal[value=${CYRILLIC}]`, message: CYRILLIC_MESSAGE },
  { selector: `TemplateElement[value.cooked=${CYRILLIC}]`, message: CYRILLIC_MESSAGE },
];
// G5: any JSX text containing a letter (Latin, Latin-1/Extended, Cyrillic). eslint-plugin-i18next 6.1.5
// was dropped because it skips concise arrow bodies such as `() => <p>text</p>`. esquery regexes do not
// support \p{L}, hence the explicit ranges.
const JSX_TEXT_BAN = [
  {
    selector: 'JSXText[value=/[A-Za-z\\u00C0-\\u024F\\u0400-\\u04FF]/]',
    message:
      'No literal text in JSX: add a key to packages/shared/i18n/mn.json and render t(key) (ADR-0011).',
  },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/dist-worker/**',
    '**/build/**',
    '**/coverage/**',
    '**/.expo/**',
    '**/.vite/**',
    'tmp/**',
    // Other Claude Code sessions' worktrees: checkouts of their own, linted there.
    '.claude/**',
    'packages/api-client/src/generated/**',
    'apps/api/src/db/migrations/**',
    'tools/lint-guards/fixtures/**',
  ]),
  {
    name: 'guard/G6',
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
  },
  js.configs.recommended,
  {
    name: 'ts',
    files: TS,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: ROOT } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  { name: 'js', files: JS, languageOptions: { globals: globals.node } },
  {
    name: 'js-commonjs',
    files: ['**/*.cjs', 'apps/api/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    name: 'type-imports',
    files: ['apps/web/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    name: 'web',
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    // shadcn/ui components export variant helpers next to components by design.
    name: 'web-shadcn',
    files: ['apps/web/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // testing-library/jest-dom#738 type shim: an empty interface that only merges matcher types.
    name: 'web-jest-dom-shim',
    files: ['apps/web/src/test/jest-dom-vitest5.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  {
    name: 'tests',
    files: TESTS,
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    name: 'guard/G1',
    files: ['apps/**/*.{ts,tsx,mts,cts}', 'packages/**/*.{ts,tsx,mts,cts}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/include': ['apps/**', 'packages/**'],
      'boundaries/ignore': ['**/dist/**', 'packages/api-client/src/generated/**'],
      // Array order = priority (partialMatch: false matches whole folders).
      'boundaries/elements': [
        {
          type: 'api-module',
          pattern: 'apps/api/src/modules/*',
          partialMatch: false,
          capture: ['module'],
        },
        {
          type: 'api-integration',
          pattern: 'apps/api/src/integrations/*',
          partialMatch: false,
          capture: ['integration'],
        },
        { type: 'app', pattern: 'apps/*', partialMatch: false, capture: ['app'] },
        { type: 'package', pattern: 'packages/*', partialMatch: false, capture: ['pkg'] },
      ],
      'boundaries/files': [
        { pattern: TESTS, category: 'test' },
        { pattern: '**/jobs/*.job.ts', category: 'job' },
        { pattern: '**/*-flow.service.ts', category: 'flow-service' },
        { pattern: 'apps/api/src/*.module.ts', category: 'composition-root' },
      ],
      // Workspace packages are treated as external modules (resolved by package name, not path).
      'boundaries/flag-as-external': { customSourcePatterns: ['@tugeel/*'] },
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'] },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        { default: 'allow', checkAllOrigins: true, policies: POLICIES },
      ],
    },
  },
  {
    name: 'guard/G2',
    files: ['apps/api/**/*.{ts,mts,cts}'],
    ignores: [
      'apps/api/src/modules/inventory/services/stock-posting.service.ts',
      'apps/api/src/modules/inventory/**/*.{spec,test}.ts',
      'apps/api/src/modules/inventory/**/__tests__/**',
      // Drizzle needs the whole aggregated schema namespace (ADR-0024); they never write tables.
      'apps/api/src/common/db/db.module.ts',
      'apps/api/src/common/db/db.types.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/',
              importNames: ['stockLedger', 'stockValuationAdjustments'],
              message:
                'stockLedger and stockValuationAdjustments are imported only by inventory/services/stock-posting.service.ts and inventory tests (§3.1 rule 2, ADR-0007, ADR-0034).',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'guard/TX',
    files: ['apps/api/src/**/*.{ts,mts,cts}'],
    rules: { 'no-restricted-syntax': ['error', ...TX_GUARD] },
  },
  {
    name: 'guard/G3',
    files: ['apps/api/src/modules/**/*.{ts,mts,cts}'],
    rules: { 'no-restricted-syntax': ['error', ...NUMBER_PARSE_BAN, ...TX_GUARD] },
  },
  {
    name: 'guard/G4-G5',
    files: ['**/*.tsx'],
    ignores: TESTS,
    rules: { 'no-restricted-syntax': ['error', ...CYRILLIC_BAN, ...JSX_TEXT_BAN] },
  },
  prettier,
]);
