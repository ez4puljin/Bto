import { resolve, relative, isAbsolute } from 'node:path';
import { QA_DATABASE } from './dataset.mjs';

export const QA_API_PORT = 3301;
export const QA_WEB_PORT = 5174;
export const QA_ADMIN_LOGIN = 'qa-admin';

export function qaAdminLogin(values) {
  const login = values.BTO_QA_ADMIN_LOGIN ?? QA_ADMIN_LOGIN;
  if (typeof login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(login))
    throw new Error('Invalid private QA administrator login');
  return login;
}

export function assertQaUrl(value, label = 'database') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label} URL (value suppressed)`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '15432' ||
    url.pathname !== `/${QA_DATABASE}` ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} must target 127.0.0.1:15432/${QA_DATABASE}, without query overrides`);
  return url;
}

export function withQaDatabase(value) {
  const url = new URL(value);
  url.pathname = `/${QA_DATABASE}`;
  assertQaUrl(url.href);
  return url.href;
}

export function assertClientTarget(client) {
  const p = client.connectionParameters;
  if (!p || p.host !== '127.0.0.1' || String(p.port) !== '15432' || p.database !== QA_DATABASE)
    throw new Error('QA clock refuses a client outside its dedicated database');
}

export function assertRunDirectory(repo, directory) {
  if (typeof repo !== 'string' || !repo.trim()) throw new Error('Explicit --repo is required');
  const root = resolve(repo, '.data/local-dev/qa-six-month');
  const target = resolve(directory ?? root);
  const tail = relative(root, target);
  if (tail.startsWith('..') || isAbsolute(tail))
    throw new Error(
      'Run directory must remain under the installed checkout .data/local-dev/qa-six-month',
    );
  return target;
}

export function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}

/** The allowlist deliberately has no provider, printing, fiscal, phone or customer-notice routes. */
export function assertApiPath(path) {
  const decoded = decodeURIComponent(path);
  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    decoded.includes('#') ||
    /(?:^|\/)\.\.(?:\/|$)/.test(decoded)
  )
    throw new Error('API path escapes the dedicated QA origin');
  const root = decoded.slice(1).split(/[/?]/)[0];
  const allowed = new Set([
    'auth',
    'me',
    'users',
    'roles',
    'branches',
    'warehouses',
    'bins',
    'uoms',
    'categories',
    'supplier-categories',
    'suppliers',
    'customers',
    'products',
    'product-locations',
    'product-suppliers',
    'product-prices',
    'price-profiles',
    'pricing',
    'receipts',
    'receipt-lines',
    'settings',
    'purchase-orders',
    'sales-boards',
    'sales-pipelines',
    'sales-orders',
    'transfers',
    'invoices',
    'credit-notes',
    'payments',
    'gl-accounts',
    'money-accounts',
    'journal-entries',
    'supplier-balances',
    'customer-balances',
    'finance',
    'finance-settings',
    'inventory',
    'pos',
    'expiry',
    'stocktakes',
    'adjustments',
    'goods-issues',
    'hr',
    'payroll',
  ]);
  if (!allowed.has(root)) throw new Error(`API route root excluded from QA history: ${root}`);
  if (root === 'settings' && decoded.split('?')[0] !== '/settings')
    throw new Error('Only the ordinary company setting collection is allowed');
  const blocked =
    /(?:^|\/)(?:erkhet|erxes|ebarimt|ebarimt-check|sms|settlement-sms|phone-lines|print-stations|print-jobs|year-close|close-year|reopen|notifications)(?:\/|$)/i;
  if (blocked.test(decoded.split('?')[0]))
    throw new Error('External/fiscal/notification action is excluded from QA history');
  return path;
}
