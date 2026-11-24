// The inbox gate's automatic review (ADR-0249): the parts that are rules, not judgement. inbox.sh
// calls it; nothing here calls an AI, runs a suite or writes the gate's books.
//
//   node tools/brain/review.mjs owner-only --repo <dir> --base <rev> --head <rev>
//        what holds the change for the owner (exit 10: the rules, one a line), or nothing: every path
//        is on AI_MAY_APPROVE and no diff rule holds (exit 0); 1 when it cannot tell
//   node tools/brain/review.mjs decide <path>…  per path: «AI <entry>» or «OWNER <rule>»
//   node tools/brain/review.mjs scrub [--env-from <copy>]  stdin, a line that looks secret replaced
//   node tools/brain/review.mjs i18n --repo <dir> --base <rev> --head <rev>
//        the existing texts of packages/shared/i18n/*.json changed or removed (exit 10), or none (0)
//   node tools/brain/review.mjs verdict <answer.json> [--env-from <copy>]
//        the reviewer's verdict, read strictly from the Claude CLI's final structured answer:
//        «APPROVE» or «BLOCK <n>» then one finding a line (exit 0), or «ERROR <kind>: <detail>» (exit 3)
//   node tools/brain/review.mjs model <answer.json>  the model that answered (nothing when unknown)
//   node tools/brain/review.mjs schema          the JSON schema the CLI's answer must follow
//   node tools/brain/review.mjs failures <log>  the failing suites and tests of a jest run (names only)
//   node tools/brain/review.mjs safe [<max>]    stdin as text safe to show (board.mjs safeText), one line
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeText } from './board.mjs';

/*
 * What the machine may land and what stays the owner's (ADR-0249 §2). A path is decided in this order:
 *   1. OWNER_ONLY: a named reason it is the owner's (first line that holds);
 *   2. a test file: decided by its subject (the file it tests), see testSubject;
 *   3. AI_MAY_APPROVE: the only areas the suites and the AI reviewer may land;
 *   4. OWNER_FALLBACK: named reasons for the rest of the tree the allow-list leaves out;
 *   5. otherwise `unlisted`: the owner's. A head reaches the AI only when every path is on the
 *      allow-list and no diff rule (wording, tests-weakened, binary, route-rights) holds it.
 * A test walks the repository's own files and asserts that none is `unlisted`: a new area is decided
 * here on purpose, not by default.
 */
export const OWNER_ONLY = [
  // A migration goes onto the real system at once and a deploy cannot roll back past it (ADR-0206).
  {
    rule: 'migration',
    why: 'a migration goes live at once and cannot be rolled back (ADR-0206)',
    test: (p) =>
      /^apps\/api\/src\/db\/migrations\//.test(p) ||
      /^apps\/api\/drizzle[^/]*\.config\.ts$/.test(p),
  },
  // The schema, a module's tables and the database's provisioning: a change needs a migration.
  {
    rule: 'schema',
    why: 'the database schema and its provisioning (a change needs a migration)',
    test: (p) =>
      /^apps\/api\/src\/db\//.test(p) ||
      /^apps\/api\/src\/.*(^|\/)(schema|[^/]+\.schema)\.ts$/.test(p),
  },
  // A decision record, and the books only the brain writes.
  {
    rule: 'decision',
    why: "ADRs, the status book and the architecture are the owner's",
    test: (p) =>
      /^docs\/decisions\//.test(p) ||
      ['docs/STATUS.md', 'docs/architecture.md', 'docs/SPEC.md'].includes(p),
  },
  // Module boundaries: a module's public face (index.ts), its Nest module and hooks other modules
  // call, the api's root files (app.module.ts, entry points), a package's index (architecture §3, §4).
  {
    rule: 'boundaries',
    why: "a module's public face or the app's wiring (module boundaries)",
    test: (p) =>
      /^apps\/api\/src\/modules\/[^/]+\/(index|hooks)\.ts$/.test(p) ||
      /^apps\/api\/src\/.*\.module\.ts$/.test(p) ||
      /^apps\/api\/src\/[^/]+\.ts$/.test(p) ||
      /^packages\/[^/]+\/src\/index\.ts$/.test(p),
  },
  // The till: the kiosk, its server (the edge) and the pos module; a mistake stops the shop's sales.
  {
    rule: 'till',
    why: 'the till (kiosk, edge, pos) stops the shop when it breaks',
    test: (p) =>
      /^apps\/web\/src\/pos\//.test(p) ||
      p === 'apps/web/pos.html' ||
      /^apps\/api\/src\/edge(\/|\.ts$)/.test(p) ||
      hasSegment(p, ['pos']),
  },
  // Money: the books, payments, cash, e-Barimt, Erkhet, payroll, the Finance Core and their tests.
  {
    rule: 'money',
    why: 'money and the books (finance, payments, cash, e-Barimt, Erkhet, payroll)',
    test: (p) =>
      hasSegment(p, [
        'finance',
        'finance-core',
        'fin-bridge',
        'fin-contract',
        'money',
        'payments',
        'payment',
        'cash',
        'ebarimt',
        'ebarimt-check',
        'erkhet',
        'erkhet-stock',
        'payroll',
      ]) ||
      /^apps\/api\/test\/integration\/(fin|finance|payroll|ebarimt|erkhet|cash|payment|bank)[^/]*$/.test(
        p,
      ) ||
      p === 'apps/api/src/repost-journal.ts',
  },
  // The integrity suite is the last net under stock and money; it is never weakened.
  {
    rule: 'integrity',
    why: 'the integrity suite (never weakened, CLAUDE.md NEVER)',
    test: (p) => /^apps\/api\/test\/(integrity|harness)\//.test(p),
  },
  // Identity and rights: who may sign in and do what (also a customer's account and password), and
  // the AI assistant's guard on what it may read.
  {
    rule: 'rights',
    why: "identity, sign-in, roles and permissions (and the AI's data guard)",
    test: (p) =>
      hasSegment(p, ['identity', 'auth', 'roles', 'permissions', 'guards']) ||
      /(^|\/)[^/]*guard[^/]*\.ts$/.test(p) ||
      /^apps\/api\/src\/modules\/ai\//.test(p) ||
      /^apps\/api\/src\/.*(account|password|login|token|session|otp)[^/]*\.ts$/.test(p) ||
      /^apps\/api\/test\/integration\/(auth|customer-auth|customer-app-account|company-roles|create-admin|ai)[^/]*$/.test(
        p,
      ),
  },
  // Ordering inside an otherwise allowed api module (the customer app places sales orders): an order
  // reserves stock and books a sale. Their read side stays allowed.
  {
    rule: 'orders',
    why: 'placing an order reserves stock and books a sale',
    test: (p) =>
      /^apps\/api\/src\/modules\/[^/]+\/.*(order|cart|checkout|shop)[^/]*\.ts$/.test(p) &&
      !/-query\.service\.ts$/.test(p) &&
      !/\/dto\//.test(p),
  },
  // The staff app's sync and stock-moving screens: what it queues offline and posts later.
  {
    rule: 'staff-app-sync',
    why: "the staff app's offline queue, api client, orders, picking, transfers and counts",
    test: (p) =>
      /^apps\/mobile\/src\/(outbox|offline|api|cart|orders|transfers|counts|picking)\//.test(p) ||
      /^apps\/mobile\/app\/.*\/(order|store-orders|transfers|counts|picking)(\/|\.tsx$)/.test(p) ||
      /^apps\/mobile\/app\/.*\/checkout\.tsx$/.test(p),
  },
  // Outside services: what leaves this PC (PosAPI, SMS, LLMs) and with which credentials.
  {
    rule: 'integrations',
    why: 'calls to outside services and their credentials',
    test: (p) => /^apps\/api\/src\/integrations\//.test(p),
  },
  // Configs and guards the gate does not already refuse: build, test and app configs, the env.
  {
    rule: 'config',
    why: 'a build, test, app or environment config',
    test: (p) =>
      (!p.includes('/') && !p.endsWith('.md')) ||
      /(^|\/)(vite|vitest|jest|metro|babel|drizzle|playwright)\.config\.[cm]?[jt]s$/.test(p) ||
      /(^|\/)tsconfig[^/]*\.json$/.test(p) ||
      /(^|\/)(Dockerfile[^/]*|\.dockerignore|docker-compose[^/]*)$/.test(p) ||
      /(^|\/)(nest-cli|components|app|eas|variants)\.json$/.test(p) ||
      /^apps\/mobile\/app\.config\.[jt]s$/.test(p) ||
      /(^|\/)\.env[^/]*$/.test(p) ||
      /(^|\/)\.(prettierrc|prettierignore|editorconfig|gitignore|npmrc|nvmrc)[^/]*$/.test(p) ||
      /(^|\/)package\.json$/.test(p) ||
      /^apps\/api\/src\/common\/config\//.test(p) ||
      /^apps\/mobile\/src\/(config|server)\//.test(p),
  },
  // The repository's tools, deploy and CI (the gate refuses most of them before the review).
  {
    rule: 'tools',
    why: "the repository's tools, deploy and CI",
    test: (p) => /^(tools|deploy|ci|scripts)\//.test(p) || /^\.[^/]+\//.test(p),
  },
];

/** The only areas the suites and the AI may land (a path no OWNER_ONLY line holds). */
export const AI_MAY_APPROVE = [
  // Reports and master data: no stock or money posting (their schema, hooks, index, Nest module and
  // ordering stay owner-only above).
  {
    entry: 'api-read-modules',
    why: 'reports and master data (reporting, catalog, partners, customer)',
    test: (p) => /^apps\/api\/src\/modules\/(reporting|catalog|partners|customer)\//.test(p),
  },
  // Any other module: only its read side and its request/response shapes.
  {
    entry: 'api-read-side',
    why: "a module's read-side queries and its DTOs",
    test: (p) =>
      /^apps\/api\/src\/modules\/[^/]+\/services\/[^/]+-query\.service\.ts$/.test(p) ||
      /^apps\/api\/src\/modules\/[^/]+\/dto\//.test(p),
  },
  // The generated api client (pnpm gen:api), alone or with an allowed api change.
  {
    entry: 'api-client',
    why: 'the generated api client',
    test: (p) =>
      p === 'packages/api-client/openapi.json' || /^packages\/api-client\/src\/generated\//.test(p),
  },
  // The office's screens (the till is owner-only above).
  {
    entry: 'web',
    why: "the office's screens",
    test: (p) => /^apps\/web\/(src\/|public\/|index\.html$)/.test(p),
  },
  // The staff app's screens (its sync, orders, picking, transfers and counts are owner-only above).
  {
    entry: 'mobile',
    why: "the staff app's screens",
    test: (p) => /^apps\/mobile\/(app|src|assets)\//.test(p),
  },
  // Documents and the guide (decisions and the books are owner-only above).
  {
    entry: 'docs',
    why: 'documents',
    test: (p) => /^docs\//.test(p) || p.endsWith('.md'),
  },
  // New translation keys (a changed or removed existing text is the diff rule `wording`).
  {
    entry: 'i18n-keys',
    why: 'new texts',
    test: (p) => I18N.test(p),
  },
];

/** Named reasons for what the allow-list leaves out. */
export const OWNER_FALLBACK = [
  // A test whose subject is not an area the AI may land.
  {
    rule: 'tests',
    why: 'a test of an area the automatic review may not land',
    test: (p) => isTestFile(p) || /^apps\/api\/test\//.test(p),
  },
  // Every other api module file: services, controllers, jobs that may post stock or money.
  {
    rule: 'api-write',
    why: "an api module's write side (stock, money, prices, documents)",
    test: (p) => /^apps\/api\/src\/modules\//.test(p),
  },
  // The api's platform: the database access, transactions, jobs, errors, imports, reports' gate.
  {
    rule: 'api-platform',
    why: "the api's shared platform (db, transactions, jobs, errors)",
    test: (p) => /^apps\/api\//.test(p),
  },
  // Shared packages: pricing, units, inventory, sales rules every client uses.
  {
    rule: 'shared',
    why: 'shared packages (pricing, units, inventory, sales rules every client uses)',
    test: (p) => /^packages\//.test(p),
  },
  // The apps' own build and platform files outside their screens.
  {
    rule: 'app-platform',
    why: "an app's build or platform files",
    test: (p) => /^apps\//.test(p),
  },
];

const UNLISTED = {
  rule: 'unlisted',
  why: 'not on the list of what the automatic review may land',
};

/** True when a folder of the path (not its file name) is one of these names. */
function hasSegment(p, names) {
  const parts = p.split('/');
  parts.pop();
  return parts.some((part) => names.includes(part));
}

const TEST_FILE = /\.(spec|test|int-spec)\.[cm]?[jt]sx?$/;
export const isTestFile = (p) => TEST_FILE.test(p);

/** Integration suites by the area they test: only these may land with the AI's approval. */
const INT_SPEC_AREAS = [
  [/^(catalog)([-.]|$)/, 'catalog'],
  [/^(partners?|customers|suppliers?)([-.]|$)/, 'partners'],
  [/^(customer-app)([-.]|$)/, 'customer'],
  [/^(reporting|reports?)([-.]|$)/, 'reporting'],
];

/**
 * The file a test is about: `x.spec.ts` → `x.ts`; an integration suite → a file of the module its
 * name names (only the allowed modules; others have none). null: no subject the AI may judge.
 */
export function testSubject(p) {
  const m = /^apps\/api\/test\/integration\/([^/]+)\.int-spec\.ts$/.exec(p);
  if (m) {
    const area = INT_SPEC_AREAS.find(([re]) => re.test(m[1]));
    return area ? `apps/api/src/modules/${area[1]}/services/${m[1]}.ts` : null;
  }
  if (/^apps\/api\/test\//.test(p)) return null;
  return p.replace(/\.(spec|test)(\.[cm]?[jt]sx?)$/, '$2');
}

/** decide(path) → { list: 'owner', rule, why } | { list: 'ai', entry, why }. */
export function decide(p) {
  const deny = OWNER_ONLY.find((r) => r.test(p));
  if (deny) return { list: 'owner', rule: deny.rule, why: deny.why };
  if (isTestFile(p)) {
    const subject = testSubject(p);
    const d = subject && subject !== p ? decide(subject) : null;
    if (d?.list === 'ai')
      return { list: 'ai', entry: `tests:${d.entry}`, why: `tests of ${d.why}` };
  } else {
    const allow = AI_MAY_APPROVE.find((e) => e.test(p));
    if (allow) return { list: 'ai', entry: allow.entry, why: allow.why };
  }
  const fallback = OWNER_FALLBACK.find((r) => r.test(p));
  if (fallback) return { list: 'owner', rule: fallback.rule, why: fallback.why };
  return { list: 'owner', ...UNLISTED };
}

/** The rules a list of paths falls under: [{ rule, why, files }], in the order first met. */
export function ownerRules(paths) {
  const held = new Map();
  for (const p of paths) {
    const d = decide(p);
    if (d.list !== 'owner') continue;
    if (!held.has(d.rule)) held.set(d.rule, { rule: d.rule, why: d.why, files: [] });
    held.get(d.rule).files.push(p);
  }
  return [...held.values()];
}

// --- what a diff does, beyond its paths ------------------------------------------------------------

const DECL = /(?<![\w.$])(?:it|test)(?:\.each)?\s*\(/g;
const SKIPS =
  /(?<![\w.$])(?:(?:it|test|describe)\.(?:skip|only|todo)\b|x(?:it|test|describe)\s*\(|f(?:it|describe)\s*\()/g;
const count = (text, re) => (String(text).match(re) ?? []).length;

/** A test file weakened between base and head: deleted, fewer tests, or more skipped/only/todo. */
export function testsWeakened(baseText, headText) {
  if (baseText === undefined) return null;
  if (headText === undefined) return 'deleted';
  const before = count(baseText, DECL);
  const after = count(headText, DECL);
  if (after < before) return `${before} → ${after} tests`;
  if (count(headText, SKIPS) > count(baseText, SKIPS)) return 'a skip, only or todo added';
  return null;
}

/** A binary file the AI cannot read: only the apps' images may change. */
export const IMAGE_ASSET =
  /^apps\/(web\/(public|src)|mobile\/(assets|app|src))\/.*\.(png|jpe?g|gif|webp|ico|bmp)$/i;

/** A changed line (added or removed) that sets a route's right: the rule `route-rights`. */
const ROUTE_RIGHT = /@(Public|Authenticated|RequirePermission|CustomerRoute)\s*\(/;

// --- the texts (owner 2026-11-24: existing wording is the owner's) -------------------------------

/** Every .json under packages/shared/i18n, at any depth, gets the wording check. */
const I18N = /^packages\/shared\/i18n\/.+\.json$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The existing values of a translation file that the head changes or removes, by key path: an added
 * key is fine. `base`/`head` are parsed JSON (undefined: the file is absent there).
 */
export function i18nChanges(base, head, prefix = '') {
  const out = [];
  if (base === undefined) return out;
  if (!isObject(base)) {
    if (head === undefined) out.push({ key: prefix, old: base, new: undefined });
    else if (JSON.stringify(base) !== JSON.stringify(head))
      out.push({ key: prefix, old: base, new: head });
    return out;
  }
  if (head !== undefined && !isObject(head)) {
    out.push({ key: prefix, old: '{…}', new: head });
    return out;
  }
  for (const key of Object.keys(base)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...i18nChanges(base[key], head === undefined ? undefined : head[key], path));
  }
  return out;
}

const show = (v, max = 80) => {
  if (v === undefined) return '(removed)';
  const t = safeText(typeof v === 'string' ? v : JSON.stringify(v), max).replace(/\n/g, ' ');
  return `«${t}»`;
};

/** One line per change, bounded: `file: key: «old» → «new»`. */
export function i18nLines(file, changes, max = 40) {
  const lines = changes
    .slice(0, max)
    .map((c) => `${file}: ${c.key}: ${show(c.old)} → ${show(c.new)}`);
  if (changes.length > max) lines.push(`${file}: … and ${changes.length - max} more`);
  return lines;
}

function git(repo, args) {
  const run = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0)
    throw new Error(`git ${args[0]}: ${(run.stderr || '').trim().split('\n').pop()}`);
  return run.stdout;
}

function changedPaths(repo, base, head) {
  return git(repo, [
    '-c',
    'core.quotePath=false',
    'diff',
    '-z',
    '--name-only',
    '--no-renames',
    base,
    head,
  ])
    .split('\0')
    .filter(Boolean);
}

/** The file's text at a revision; undefined only when the path does not exist there. Throws on
 * anything else (a revision that cannot be read), so that it never reads as «no change». */
function textAt(repo, rev, file) {
  git(repo, ['rev-parse', '--verify', '-q', `${rev}^{commit}`]);
  const exists = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${rev}:${file}`]);
  if (exists.status !== 0) {
    // cat-file -e fails both for «no such path» and for a broken object: tell them apart.
    const listed = git(repo, ['ls-tree', '--name-only', rev, '--', file]).trim();
    if (listed === '') return undefined;
    throw new Error(`cannot read ${file} at ${rev}`);
  }
  return git(repo, ['show', `${rev}:${file}`]);
}

function jsonAt(repo, rev, file) {
  const text = textAt(repo, rev, file);
  return text === undefined ? undefined : JSON.parse(text);
}

/** Every changed or removed existing text between two revisions, as lines. */
export function i18nReport(repo, base, head, paths = changedPaths(repo, base, head)) {
  const lines = [];
  for (const file of paths.filter((p) => I18N.test(p))) {
    lines.push(...i18nLines(file, i18nChanges(jsonAt(repo, base, file), jsonAt(repo, head, file))));
  }
  return lines;
}

/**
 * The rules a diff holds by what it does, beyond its paths: `tests-weakened`, `binary`,
 * `route-rights` (wording is i18nReport). [{ rule, why, files }].
 */
export function diffRules(repo, base, head, paths = changedPaths(repo, base, head)) {
  const out = [];
  const add = (rule, why, file) => {
    let r = out.find((x) => x.rule === rule);
    if (!r) out.push((r = { rule, why, files: [] }));
    r.files.push(file);
  };
  for (const file of paths.filter(isTestFile)) {
    const weak = testsWeakened(textAt(repo, base, file), textAt(repo, head, file));
    if (weak)
      add(
        'tests-weakened',
        'a test deleted, fewer tests, or a skip/only/todo added',
        `${file} (${weak})`,
      );
  }
  for (const line of git(repo, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--numstat',
    '-z',
    '--no-renames',
    base,
    head,
  ]).split('\0')) {
    const m = /^-\t-\t(.+)$/.exec(line);
    if (m && !IMAGE_ASSET.test(m[1])) add('binary', 'a binary file the reviewer cannot read', m[1]);
  }
  let file = null;
  for (const line of git(repo, [
    '-c',
    'core.quotePath=false',
    'diff',
    '-U0',
    '--no-renames',
    base,
    head,
  ]).split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('--- ')) continue;
    else if ((line.startsWith('+') || line.startsWith('-')) && ROUTE_RIGHT.test(line))
      add(
        'route-rights',
        "a route's right (@Public, @Authenticated, @RequirePermission, @CustomerRoute) added, removed or changed",
        file ?? '?',
      );
  }
  for (const r of out) r.files = [...new Set(r.files)];
  return out;
}

// --- secrets never leave this PC ------------------------------------------------------------------

export const REMOVED = '(removed: looked like a secret)';
/** What looks like a key, a token or a connection string (bounded). */
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,200}\.[A-Za-z0-9_-]{8,500}\.[A-Za-z0-9_-]{4,500}/, // a JWT
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@]{1,100}:[^\s/@]{1,200}@/i, // a URL with a password
  /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_A-Za-z0-9]{16,200}/, // API keys
  /\b(?:ghp|gho|ghs|ghu|github_pat|xox[abpr]|AKIA|AIza)[-_A-Za-z0-9]{12,200}/, // service tokens
  /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/,
  /\b(?=[A-Za-z0-9+/_-]{40,300}\b)(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9+/_-]{40,300}={0,2}/, // long random
];

/** The values of the copy's .env files (not .env.example), at least 8 characters long. */
export function envSecrets(copy) {
  const values = new Set();
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < 4 && !['node_modules', '.git', 'dist', 'build'].includes(e.name))
          walk(`${dir}/${e.name}`, depth + 1);
      } else if (/^\.env/.test(e.name) && !e.name.endsWith('.example')) {
        for (const line of readFileSync(`${dir}/${e.name}`, 'utf8').split('\n')) {
          const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
          if (!m) continue;
          const v = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
          if (v.length >= 8) values.add(v);
        }
      }
    }
  };
  if (copy) walk(copy, 0);
  return [...values];
}

/** True when the text holds a value of the .env files or looks like a secret. */
export function looksSecret(text, secrets = []) {
  const t = String(text);
  return secrets.some((v) => t.includes(v)) || SECRET_PATTERNS.some((re) => re.test(t));
}

export const scrub = (text, secrets = []) => (looksSecret(text, secrets) ? REMOVED : String(text));

// --- the reviewer's answer ----------------------------------------------------------------------

export const MAX_FINDINGS = 10;
const FINDING_TEXT = 300;

/** The shape the CLI must answer in (--json-schema); the script still checks every field itself. */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'BLOCK'] },
    findings: {
      type: 'array',
      maxItems: MAX_FINDINGS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'line', 'text'],
        properties: {
          severity: { type: 'string', enum: ['HIGH', 'MEDIUM'] },
          file: { type: 'string', maxLength: 200 },
          line: { type: 'integer', minimum: 0 },
          text: { type: 'string', maxLength: FINDING_TEXT },
        },
      },
    },
    summary: { type: 'string', maxLength: 600 },
  },
};

class AnswerError extends Error {
  constructor(kind, detail) {
    super(detail);
    this.kind = kind;
  }
}

const FILE = /^[A-Za-z0-9._@()[\]+-][A-Za-z0-9._@()[\]+/-]{0,199}$/;

/**
 * The verdict, from the CLI's whole stdout (`--output-format json`): one JSON object, a successful
 * result, and its `structured_output` in VERDICT_SCHEMA's shape. Nothing else counts: text the model
 * wrote (its `result`), a line of the diff, a verdict-looking line before the JSON, are never read as
 * the verdict. Throws AnswerError(kind) otherwise.
 */
export function parseVerdict(stdout, secrets = []) {
  let answer;
  try {
    answer = JSON.parse(String(stdout).trim());
  } catch {
    throw new AnswerError('unreadable', 'the answer is not one JSON object');
  }
  if (!isObject(answer) || answer.type !== 'result')
    throw new AnswerError('unreadable', "the answer is not the CLI's result");
  if (answer.is_error === true || answer.subtype !== 'success') {
    const said = scrub(
      safeText(String(answer.result ?? answer.subtype ?? ''), 200).replace(/\n/g, ' '),
      secrets,
    );
    const limit =
      /limit|quota|usage|rate/i.test(said) || /limit/i.test(String(answer.subtype ?? ''));
    throw new AnswerError(limit ? 'limit' : 'failed', `${answer.subtype ?? 'error'}: ${said}`);
  }
  const v = answer.structured_output;
  if (!isObject(v)) throw new AnswerError('unreadable', 'no structured verdict in the answer');
  if (v.verdict !== 'APPROVE' && v.verdict !== 'BLOCK')
    throw new AnswerError('unreadable', 'the verdict is neither APPROVE nor BLOCK');
  if (!Array.isArray(v.findings)) throw new AnswerError('unreadable', 'no findings list');
  if (v.findings.length > MAX_FINDINGS) throw new AnswerError('unreadable', 'too many findings');
  const findings = v.findings.map((f) => {
    if (
      !isObject(f) ||
      !['HIGH', 'MEDIUM'].includes(f.severity) ||
      typeof f.file !== 'string' ||
      !FILE.test(f.file) ||
      f.file.split('/').includes('..') ||
      !Number.isInteger(f.line) ||
      f.line < 0 ||
      typeof f.text !== 'string' ||
      !f.text.trim()
    )
      throw new AnswerError('unreadable', 'a finding is not in its shape');
    const text = safeText(f.text, FINDING_TEXT).replace(/\n/g, ' ');
    // A finding that quotes a secret never leaves this PC: it is replaced, not dropped silently.
    if (looksSecret(`${f.file} ${text}`, secrets))
      return { severity: f.severity, file: '(removed)', line: 0, text: REMOVED };
    return { severity: f.severity, file: f.file, line: f.line, text };
  });
  let verdict = v.verdict;
  // APPROVE with a HIGH finding contradicts itself: the gate takes the stricter reading.
  if (verdict === 'APPROVE' && findings.some((f) => f.severity === 'HIGH')) verdict = 'BLOCK';
  if (verdict === 'BLOCK' && findings.length === 0)
    throw new AnswerError('unreadable', 'BLOCK without a finding');
  return { verdict, findings, model: modelOf(answer) };
}

/** The model that answered: the CLI's `modelUsage` key (e.g. claude-sonnet-…), else `model`. */
export function modelOf(answer) {
  const used = isObject(answer?.modelUsage) ? Object.keys(answer.modelUsage) : [];
  const name = used[0] ?? answer?.model;
  return typeof name === 'string' && /^[A-Za-z0-9._:@/-]{1,80}$/.test(name) ? name : null;
}

export const findingLine = (f) => `[${f.severity}] ${f.file}:${f.line} — ${f.text}`;

// --- a red suite, by name only (the repository is public) ---------------------------------------

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** The failing suites (jest «FAIL <file>») and tests («● a › b»), at most 10 of each, no output. */
export function failuresOf(text) {
  const suites = new Set();
  const tests = new Set();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(ANSI, '');
    let m;
    if ((m = /^\s*FAIL\s+(\S+\.(?:int-spec|spec|test)\.[cm]?[jt]s)\b/.exec(line)))
      suites.add(m[1].replace(/^.*?(apps\/|test\/)/, '$1'));
    else if ((m = /^\s+● (.+›.+)$/.exec(line))) tests.add(safeText(m[1], 160).replace(/\n/g, ' '));
  }
  return { suites: [...suites].slice(0, 10), tests: [...tests].slice(0, 10) };
}

// --- the command line ---------------------------------------------------------------------------

function opt(args, name) {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1]) throw new Error(`${name} is needed`);
  return args[at + 1];
}

export function main(argv) {
  const [cmd, ...args] = argv;
  const say = (line) => process.stdout.write(`${line}\n`);
  try {
    switch (cmd) {
      case 'owner-only': {
        const repo = opt(args, '--repo');
        const base = opt(args, '--base');
        const head = opt(args, '--head');
        const paths = changedPaths(repo, base, head);
        const rules = [...ownerRules(paths), ...diffRules(repo, base, head, paths)];
        for (const r of rules) {
          const files =
            r.files.slice(0, 5).join(' ') + (r.files.length > 5 ? ` (+${r.files.length - 5})` : '');
          say(`OWNER-ONLY ${r.rule}: ${r.why}: ${files}`);
        }
        const texts = i18nReport(repo, base, head, paths);
        if (texts.length) {
          say(
            "OWNER-ONLY wording: it changes or removes existing texts (the owner's wording; a feature branch only adds keys):",
          );
          for (const line of texts) say(`  ${line}`);
        }
        return rules.length || texts.length ? 10 : 0;
      }
      case 'decide': {
        for (const p of args) {
          const d = decide(p);
          say(d.list === 'ai' ? `AI ${d.entry}  ${p}` : `OWNER ${d.rule}  ${p}`);
        }
        return 0;
      }
      case 'scrub': {
        const secrets = envSecrets(args.includes('--env-from') ? opt(args, '--env-from') : null);
        for (const line of readFileSync(0, 'utf8').split('\n')) if (line) say(scrub(line, secrets));
        return 0;
      }
      case 'i18n': {
        const lines = i18nReport(opt(args, '--repo'), opt(args, '--base'), opt(args, '--head'));
        for (const line of lines) say(line);
        return lines.length ? 10 : 0;
      }
      case 'verdict': {
        try {
          const secrets = envSecrets(args.includes('--env-from') ? opt(args, '--env-from') : null);
          const v = parseVerdict(readFileSync(args[0], 'utf8'), secrets);
          say(v.verdict === 'APPROVE' ? 'APPROVE' : `BLOCK ${v.findings.length}`);
          for (const f of v.findings) say(findingLine(f));
          return 0;
        } catch (e) {
          if (!(e instanceof AnswerError)) throw e;
          say(`ERROR ${e.kind}: ${e.message}`);
          return 3;
        }
      }
      case 'model': {
        try {
          const name = modelOf(JSON.parse(readFileSync(args[0], 'utf8')));
          if (name) say(name);
        } catch {
          // no answer, no model
        }
        return 0;
      }
      case 'schema':
        say(JSON.stringify(VERDICT_SCHEMA));
        return 0;
      case 'failures': {
        const { suites, tests } = failuresOf(readFileSync(args[0], 'utf8'));
        for (const s of suites) say(`suite ${s}`);
        for (const t of tests) say(`test ${t}`);
        return suites.length || tests.length ? 0 : 3;
      }
      case 'safe': {
        const max = Number.parseInt(args[0] ?? '600', 10);
        say(safeText(readFileSync(0, 'utf8'), max).replace(/\n+/g, ' '));
        return 0;
      }
      default:
        process.stderr.write('review.mjs owner-only|i18n|verdict|schema|failures|safe …\n');
        return 64;
    }
  } catch (e) {
    process.stderr.write(`review.mjs ${cmd}: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
