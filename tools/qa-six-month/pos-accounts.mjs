import { FIRST_DAY } from './dataset.mjs';
import { exactlyOne } from './journal.mjs';

// These are the existing application's normal default chart entries, not new accounting policy.
export const POS_ACCOUNT_DEFAULTS = [
  { role: 'POS_CASH', code: '100102', kind: 'ASSET', name: 'POS cash clearing' },
  { role: 'CARD_CLEARING', code: '120301', kind: 'ASSET', name: 'Card clearing' },
  { role: 'POS_SALES', code: '510102', kind: 'INCOME', name: 'POS sales' },
  { role: 'CASH_VARIANCE', code: '740101', kind: 'EXPENSE', name: 'Cash count variance' },
];

/** Normal admin setup via public HTTP. Never rewrites existing/future rules or ledger entries. */
export async function configurePosAccounts(ctx) {
  if (ctx.runtime.clock.day !== FIRST_DAY)
    throw new Error('POS setup requires the declared opening business day');
  const accounts = await ctx.all('/gl-accounts');
  const rules = (
    await ctx.runtime.reader.query(
      `SELECT r.posting_key,r.account_id,r.effective_from::text,a.status
    FROM fin.posting_rules r LEFT JOIN fin.accounts a ON a.company_id=r.company_id AND a.id=r.account_id
    WHERE r.company_id=(SELECT company_id FROM fin.accounts WHERE id=$1)
    ORDER BY r.posting_key,r.effective_from DESC,r.id DESC`,
      [ctx.refs.accounts.bank.id],
    )
  ).rows;
  const effective = new Map();
  for (const rule of rules)
    if (rule.effective_from <= FIRST_DAY && !effective.has(rule.posting_key))
      effective.set(rule.posting_key, rule);
  // Preflight all four before the first write. An existing non-POS mapping is never reassigned.
  for (const spec of POS_ACCOUNT_DEFAULTS) {
    const held = effective.get(spec.role);
    if (held?.account_id && held.status !== 'ACTIVE')
      throw new Error(`Inactive existing POS mapping ${spec.role}`);
    if (held?.account_id) continue;
    const account = exactlyOne(
      accounts.filter((a) => a.code === spec.code),
      `POS default ${spec.code}`,
    );
    if (
      account &&
      (account.kind !== spec.kind ||
        account.status !== 'ACTIVE' ||
        account.journal !== 'GENERAL' ||
        account.currency !== 'MNT' ||
        rules.some(
          (r) => Number(r.account_id) === Number(account.id) && r.posting_key !== spec.role,
        ))
    )
      throw new Error(`POS default account ${spec.code} conflicts with existing configuration`);
    if (rules.some((r) => r.posting_key === spec.role))
      throw new Error(
        `POS ${spec.role} has existing/future rule history; inspect it before adding an earlier mapping`,
      );
  }
  const evidence = [];
  for (const spec of POS_ACCOUNT_DEFAULTS) {
    const held = effective.get(spec.role);
    if (held?.account_id) {
      const pendingKey = `setup/pos-role/${spec.role}`;
      if (ctx.state.operations[pendingKey])
        await ctx.write(
          pendingKey,
          'PUT',
          `/gl-accounts/${Number(held.account_id)}/role`,
          { role: spec.role },
          {
            recover: async () =>
              exactlyOne(
                (await ctx.all('/gl-accounts')).filter(
                  (a) => Number(a.id) === Number(held.account_id) && a.role === spec.role,
                ),
                `POS role ${spec.role}`,
              ),
          },
        );
      evidence.push({ role: spec.role, accountId: Number(held.account_id), existing: true });
      continue;
    }
    const account = await ctx.create(
      `setup/pos-account/${spec.role}`,
      '/gl-accounts',
      {
        code: spec.code,
        name: `QA ${spec.name}`,
        kind: spec.kind,
        journal: 'GENERAL',
        currency: 'MNT',
      },
      { match: (a) => a.code === spec.code },
    );
    await ctx.write(
      `setup/pos-role/${spec.role}`,
      'PUT',
      `/gl-accounts/${account.id}/role`,
      { role: spec.role },
      {
        recover: async () =>
          exactlyOne(
            (await ctx.all('/gl-accounts')).filter(
              (a) => a.id === account.id && a.role === spec.role,
            ),
            `POS role ${spec.role}`,
          ),
      },
    );
    evidence.push({
      role: spec.role,
      accountId: account.id,
      code: spec.code,
      effectiveFrom: FIRST_DAY,
      existing: false,
    });
  }
  ctx.refs.accountRoles = Object.fromEntries(
    (await ctx.all('/gl-accounts')).filter((a) => a.role).map((a) => [a.role, a]),
  );
  const verified = (
    await ctx.runtime.reader.query(
      `SELECT DISTINCT ON(posting_key) posting_key,account_id
    FROM fin.posting_rules WHERE company_id=(SELECT company_id FROM fin.accounts WHERE id=$1)
      AND posting_key=ANY($2::text[]) AND effective_from<=$3
    ORDER BY posting_key,effective_from DESC,id DESC`,
      [ctx.refs.accounts.bank.id, POS_ACCOUNT_DEFAULTS.map((s) => s.role), FIRST_DAY],
    )
  ).rows;
  if (
    verified.length !== POS_ACCOUNT_DEFAULTS.length ||
    verified.some((r) => r.account_id === null)
  )
    throw new Error('Public POS role setup did not produce complete opening-day mappings');
  ctx.state.checks.posChartSetup = {
    effectiveFrom: FIRST_DAY,
    method: 'Public account create and role API',
    accounts: evidence,
  };
  await ctx.save();
}
