import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const OFFICE_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'office',
  fullName: 'Оффисын Сараа',
  permissions: ['partners.customers.read', 'partners.customers.manage'],
  roles: [{ id: 2, code: 'OFFICE', name: null, isSystem: true }],
};
const READER_ME: Me = { ...OFFICE_ME, permissions: ['partners.customers.read'] };

const CATEGORIES: Schemas['CustomerCategory'][] = [
  { id: 4, name: '1-р хороо', active: true, sortOrder: 10 },
  { id: 5, name: 'Алаг-Эрдэнэ', active: true, sortOrder: 20 },
  { id: 6, name: 'Хуучин бүс', active: false, sortOrder: 30 },
];
const categoryRoutes = { 'GET /api/v1/customer-categories': () => json(CATEGORIES) };

/** Customer categories (ADR-0107): the page, and the create form's code that follows them. */
describe('customer categories', () => {
  it('lists the categories, adds one and retires one', async () => {
    const posts: unknown[] = [];
    const patches: { id: string; body: unknown }[] = [];
    const fetchMock = signedIn(OFFICE_ME, {
      ...categoryRoutes,
      'POST /api/v1/customer-categories': async (request) => {
        posts.push(await request.json());
        return json({ id: 7, name: 'Шинэ бүс', active: true, sortOrder: 40 }, 201);
      },
      'PATCH /api/v1/customer-categories/4': async (request) => {
        patches.push({ id: '4', body: await request.json() });
        return json({ ...CATEGORIES[0], active: false });
      },
    });
    renderApp('/partners/customer-categories', fetchMock);
    const user = userEvent.setup();
    const table = within(await screen.findByRole('table'));
    expect(
      await table.findByRole('link', {
        name: mn.partners.categories.showCustomers.replace('{{name}}', '1-р хороо'),
      }),
    ).toHaveAttribute('href', '/partners/customers?category=4');
    expect(table.getByText(mn.partners.categories.inactive)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.partners.categories.create }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.partners.categories.name), 'Шинэ бүс');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(posts).toEqual([{ name: 'Шинэ бүс' }]));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(
      await table.findByRole('button', {
        name: mn.partners.categories.retire.replace('{{name}}', '1-р хороо'),
      }),
    );
    await waitFor(() => expect(patches).toEqual([{ id: '4', body: { active: false } }]));
  });

  it('shows the list without the buttons to a reader', async () => {
    renderApp('/partners/customer-categories', signedIn(READER_ME, categoryRoutes));
    const table = within(await screen.findByRole('table'));
    expect(await table.findByText('Алаг-Эрдэнэ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.partners.categories.create })).toBeNull();
    expect(
      table.queryByRole('button', {
        name: mn.partners.categories.retire.replace('{{name}}', '1-р хороо'),
      }),
    ).toBeNull();
  });

  it('follows the chosen category with the suggested code until the office types its own', async () => {
    const posted: unknown[] = [];
    const fetchMock = signedIn(OFFICE_ME, {
      ...categoryRoutes,
      'GET /api/v1/customers/next-code': (request) => {
        const category = new URL(request.url).searchParams.get('categoryId');
        return json({ code: category === '4' ? '50113' : category === '5' ? '20112' : '1002' });
      },
      'POST /api/v1/customers': async (request) => {
        posted.push(await request.json());
        return json({ id: 10 }, 201);
      },
      'GET /api/v1/customers/10': () => json({}),
    });
    renderApp('/partners/customers/new', fetchMock);
    const user = userEvent.setup();
    const code = await screen.findByLabelText(mn.partners.customer.code);
    expect(code).toHaveValue('1002');
    const category = screen.getByLabelText(mn.partners.customer.category);
    // A retired category is not offered to a new customer.
    expect(within(category).queryByRole('option', { name: 'Хуучин бүс' })).toBeNull();
    await screen.findByRole('option', { name: '1-р хороо' });

    await user.selectOptions(category, '4');
    await waitFor(() => expect(code).toHaveValue('50113'));
    await user.selectOptions(category, '');
    await waitFor(() => expect(code).toHaveValue('1002'));
    await user.selectOptions(category, '4');
    await waitFor(() => expect(code).toHaveValue('50113'));

    await user.type(screen.getByLabelText(mn.partners.customer.name), 'Хорооны дэлгүүр');
    await user.selectOptions(screen.getByLabelText(mn.partners.settlement.group), 'DAY_20');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    // The suggested code is left to the server, which allocates it for the category.
    await waitFor(() =>
      expect(posted).toEqual([
        expect.objectContaining({
          categoryId: 4,
          name: 'Хорооны дэлгүүр',
          settlementGroup: 'DAY_20',
        }),
      ]),
    );
    expect(posted[0]).not.toHaveProperty('code');
  });

  it('keeps a typed code when the category changes', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      ...categoryRoutes,
      'GET /api/v1/customers/next-code': (request) =>
        json({ code: new URL(request.url).searchParams.get('categoryId') ? '50113' : '1002' }),
    });
    renderApp('/partners/customers/new', fetchMock);
    const user = userEvent.setup();
    const code = await screen.findByLabelText(mn.partners.customer.code);
    await user.clear(code);
    await user.type(code, '777');
    await screen.findByRole('option', { name: '1-р хороо' });
    await user.selectOptions(screen.getByLabelText(mn.partners.customer.category), '4');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('categoryId=4') }),
      ),
    );
    expect(code).toHaveValue('777');
  });
});
