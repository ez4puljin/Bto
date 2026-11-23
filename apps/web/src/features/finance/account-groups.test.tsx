import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls } from '@/test/inventory-fixtures';
import { choose } from '@/test/choose';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';
import { ACCOUNTS } from './finance-fixtures';

type Group = components['schemas']['GlAccountGroup'];

const group = (id: number, code: string, name: string, parentId: number | null, sort = 0) =>
  ({ id, code, name, parentId, sort, status: 'ACTIVE' }) satisfies Group;

/** «7 Зардал» › «70 Ерөнхий удирдлагын зардал» › «7011 Тог», and «5 Орлого». */
const GROUPS: Group[] = [
  group(1, '7', 'Зардал', null, 1),
  group(2, '70', 'Ерөнхий удирдлагын зардал', 1),
  group(3, '7011', 'Тог', 2),
  group(4, '5', 'Орлого', null, 0),
];

const EXPENSE = {
  ...ACCOUNTS[0]!,
  id: 20,
  code: '701101',
  name: 'Цахилгааны зардал',
  kind: 'EXPENSE' as const,
  role: null,
  groupId: 3,
};
const GROUPED = [...ACCOUNTS.map((row) => (row.id === 7 ? { ...row, groupId: 4 } : row)), EXPENSE];

const routes = () => ({
  'GET /api/v1/gl-accounts': () => json(GROUPED),
  'GET /api/v1/gl-accounts/groups': () => json(GROUPS),
});

/** A field's refusal from the core (ADR-0239). */
const refused = (path: string, constraint: string) =>
  json(
    {
      type: 'https://tugeel.local/errors/FIN_PAYLOAD_INVALID',
      title: 'FIN_PAYLOAD_INVALID',
      status: 422,
      code: 'FIN_PAYLOAD_INVALID',
      params: { path },
      errors: [{ path, constraint, message: constraint }],
    },
    422,
  );

const groupMenu = async (user: ReturnType<typeof userEvent.setup>, code: string, item: string) => {
  const row = await screen.findByRole('row', { name: new RegExp(`^${code} `) });
  await user.click(within(row).getByRole('button', { name: `${code}: ${mn.common.actions}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
};

describe('the chart’s groups on «Данс» (ADR-0239)', () => {
  it('shows the tree with the ungrouped accounts under their own heading', async () => {
    renderApp('/finance/accounts', signedIn(ADMIN_ME, routes()));
    await screen.findByRole('row', { name: /701101/ });
    await screen.findByRole('row', { name: new RegExp(mn.finance.accounts.groups.none) });
    const rows = screen.getAllByRole('row');
    const names = rows.map((row) => row.textContent ?? '');
    const at = (text: string) => names.findIndex((name) => name.includes(text));
    expect(at('Орлого')).toBeLessThan(at('510101'));
    expect(at('Ерөнхий удирдлагын зардал')).toBeLessThan(at('Тог'));
    expect(at('Тог')).toBeLessThan(at('701101'));
    expect(at(mn.finance.accounts.groups.none)).toBeLessThan(at('100101'));
    expect(at('701101')).toBeLessThan(at(mn.finance.accounts.groups.none));
  });

  it('adds a group and a sub-group, and says when the code is taken', async () => {
    const user = userEvent.setup();
    let posts = 0;
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(),
      'POST /api/v1/gl-accounts/groups': () =>
        (posts += 1) === 1
          ? refused('group.code', 'taken')
          : json(group(9, '7012', 'Дулаан', 2, 1), 201),
    });
    renderApp('/finance/accounts', fetchMock);
    await groupMenu(user, '70', mn.finance.accounts.groups.addChild);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.groups.addChild }),
    );
    expect(dialog.getByLabelText(mn.finance.accounts.groups.parent)).toHaveValue(
      '70 · Зардал › Ерөнхий удирдлагын зардал',
    );
    await user.type(dialog.getByLabelText(mn.finance.accounts.groups.code), '7011');
    await user.type(dialog.getByLabelText(mn.finance.accounts.groups.name), 'Дулаан');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(mn.errors.fields.group.code.taken);
    await user.clear(dialog.getByLabelText(mn.finance.accounts.groups.code));
    await user.type(dialog.getByLabelText(mn.finance.accounts.groups.code), '7012');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/gl-accounts/groups')).toHaveLength(2),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/gl-accounts/groups')[1])).toEqual({
      code: '7012',
      name: 'Дулаан',
      parentId: 2,
    });
    expect(await screen.findByText(mn.finance.accounts.groups.created)).toBeInTheDocument();

    // From the header: a root group.
    await user.click(screen.getByRole('button', { name: mn.finance.accounts.groups.add }));
    const root = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.groups.add }),
    );
    expect(root.getByLabelText(mn.finance.accounts.groups.parent)).toHaveValue(
      mn.finance.accounts.groups.root,
    );
  });

  it('renames, moves and deletes a group, refusing a non-empty one', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(),
      'PUT /api/v1/gl-accounts/groups/2': () => json(group(2, '70', 'Удирдлагын зардал', 1)),
      'DELETE /api/v1/gl-accounts/groups/2': () => refused('group', 'notEmpty'),
    });
    renderApp('/finance/accounts', fetchMock);

    await groupMenu(user, '70', mn.common.edit);
    const edit = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.groups.editTitle }),
    );
    expect(edit.getByLabelText(mn.finance.accounts.groups.code)).toHaveAttribute('readonly');
    await user.clear(edit.getByLabelText(mn.finance.accounts.groups.name));
    await user.type(edit.getByLabelText(mn.finance.accounts.groups.name), 'Удирдлагын зардал');
    await user.click(edit.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/groups/2')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/groups/2')[0])).toEqual({
      name: 'Удирдлагын зардал',
    });
    expect(await screen.findByText(mn.finance.accounts.groups.saved)).toBeInTheDocument();

    await groupMenu(user, '70', mn.finance.accounts.groups.move);
    const move = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.groups.moveTitle }),
    );
    await user.click(move.getByLabelText(mn.finance.accounts.groups.parent));
    // Never under itself or below it.
    expect(screen.queryByRole('option', { name: /^7011 / })).toBeNull();
    expect(screen.queryByRole('option', { name: /^70 / })).toBeNull();
    await user.click(screen.getByRole('option', { name: mn.finance.accounts.groups.root }));
    await user.click(move.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/groups/2')).toHaveLength(2),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/groups/2')[1])).toEqual({
      parentId: null,
    });

    await groupMenu(user, '70', mn.common.delete);
    const remove = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.groups.deleteTitle }),
    );
    expect(remove.getByText(new RegExp(mn.finance.accounts.groups.deleteQuestion))).toBeVisible();
    await user.click(remove.getByRole('button', { name: mn.common.delete }));
    expect(await remove.findByRole('alert')).toHaveTextContent(mn.errors.fields.group.notEmpty);
  });

  it('puts a new account in the group its code begins with and moves an account', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/gl-accounts': () => json({ ...EXPENSE, id: 21, code: '701102' }, 201),
      'PUT /api/v1/gl-accounts/20': () => json({ ...EXPENSE, groupId: 2 }),
    });
    renderApp('/finance/accounts?new=1', fetchMock);
    // The accountant keeps accounts; the tree is the admin's.
    expect(screen.queryByRole('button', { name: mn.finance.accounts.groups.add })).toBeNull();
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.dialog.createTitle }),
    );
    const picker = dialog.getByLabelText(mn.finance.accounts.groups.group);
    await user.type(dialog.getByLabelText(mn.finance.accounts.dialog.code), '701102');
    expect(picker).toHaveValue('7011 · Зардал › Ерөнхий удирдлагын зардал › Тог');
    await user.type(dialog.getByLabelText(mn.finance.accounts.dialog.name), 'Халаалт');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/gl-accounts')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/gl-accounts')[0])).toMatchObject({
      code: '701102',
      groupId: 3,
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: mn.finance.accounts.dialog.createTitle }),
      ).toBeNull(),
    );
    const row = await screen.findByRole('row', { name: /701101/ });
    expect(within(row).queryByRole('button', { name: `7011: ${mn.common.actions}` })).toBeNull();
    await user.click(within(row).getByRole('button', { name: `701101: ${mn.common.actions}` }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.edit }));
    const edit = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.dialog.editTitle }),
    );
    // Found by the code of a group on its path.
    await choose(user, edit.getByLabelText(mn.finance.accounts.groups.group), /^70 · /);
    await user.click(edit.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/20')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/20')[0])).toMatchObject({
      groupId: 2,
    });
  });

  it('saves an old account without a group as it is', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'PUT /api/v1/gl-accounts/1': () => json({ ...ACCOUNTS[0]!, name: 'Касс 1' }),
    });
    renderApp('/finance/accounts', fetchMock);
    const row = await screen.findByRole('row', { name: /100101/ });
    await user.click(within(row).getByRole('button', { name: `100101: ${mn.common.actions}` }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.edit }));
    const edit = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.dialog.editTitle }),
    );
    expect(edit.getByLabelText(mn.finance.accounts.groups.group)).toHaveValue('');
    await user.clear(edit.getByLabelText(mn.finance.accounts.dialog.name));
    await user.type(edit.getByLabelText(mn.finance.accounts.dialog.name), 'Касс 1');
    await user.click(edit.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/1')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/1')[0])).toMatchObject({
      name: 'Касс 1',
      groupId: null,
    });
  });
});
