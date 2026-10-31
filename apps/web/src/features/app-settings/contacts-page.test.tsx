import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import {
  ADMIN_ME,
  findSidebar,
  json,
  type Me,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];

const ORDERS: Schemas['CompanyContact'] = {
  id: 1,
  role: 'Захиалга, оффис',
  name: 'Сараа',
  phone: '+97699112233',
  shown: true,
};
const ACCOUNTANT: Schemas['CompanyContact'] = {
  id: 2,
  role: 'Нягтлан бодогч, тооцоо',
  name: 'Болд',
  phone: '+97688112233',
  shown: false,
};
const READER: Me = {
  ...ADMIN_ME,
  id: 7,
  username: 'reader',
  fullName: 'Уншигч Дорж',
  permissions: ['identity.settings.read'],
  roles: [],
};

const request = (contact: Schemas['CompanyContact']) => ({
  role: contact.role,
  name: contact.name,
  phone: contact.phone,
  shown: contact.shown,
});
/** The PUT answers the list it was given, with ids for the new rows. */
const saving = async (put: Request) => {
  const { contacts } = (await put.clone().json()) as {
    contacts: Schemas['CompanyContactRequest'][];
  };
  return json(contacts.map((contact, index) => ({ id: 100 + index, ...contact })));
};
const contactsCard = async () =>
  within(await screen.findByRole('region', { name: mn.customerApp.contacts.title }));

describe('app contacts menu (ADR-0079 #14, ADR-0127)', () => {
  it('shows «Холбоо барих» under «Апп» to whoever reads the settings', async () => {
    renderApp('/system/status', signedIn(READER));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.appContacts }),
    ).toHaveAttribute('href', '/app/contacts');
  });

  it('keeps the page from a user without identity.settings.read', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/app/contacts', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(
      within(await findSidebar()).queryByRole('link', { name: mn.nav.appContacts }),
    ).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/customer/contacts')).toHaveLength(0);
  });
});

describe('company contacts', () => {
  it('lists the contacts in order, read-only without identity.settings.manage', async () => {
    const fetchMock = signedIn(READER, {
      'GET /api/v1/customer/contacts': () => json([ORDERS, ACCOUNTANT]),
    });
    renderApp('/app/contacts', fetchMock);
    const card = await contactsCard();
    const rows = await card.findAllByRole('row');
    // The header row, then the contacts in their order.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(mn.customerApp.contacts.role),
      expect.stringContaining('Сараа'),
      expect.stringContaining('Болд'),
    ]);
    const saraa = within(rows[1] as HTMLElement);
    expect(saraa.getByText('Захиалга, оффис')).toBeInTheDocument();
    expect(saraa.getByRole('link', { name: '9911 2233' })).toHaveAttribute(
      'href',
      'tel:+97699112233',
    );
    expect(saraa.getByText(mn.customerApp.contacts.shownBadge)).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(mn.customerApp.contacts.hiddenBadge),
    ).toBeInTheDocument();
    expect(card.queryByRole('button')).toBeNull();
  });

  it('adds a contact, checking the fields, and saves the whole list', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/customer/contacts': () => json([ORDERS]),
      'PUT /api/v1/customer/contacts': saving,
    });
    renderApp('/app/contacts', fetchMock);
    const user = userEvent.setup();
    const card = await contactsCard();
    await card.findByText('Сараа');
    await user.click(card.getByRole('button', { name: mn.customerApp.contacts.add }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.customerApp.contacts.addTitle }),
    );
    expect(dialog.getByRole('switch', { name: mn.customerApp.contacts.shown })).toBeChecked();
    await user.type(dialog.getByLabelText(mn.customerApp.contacts.phone), '123');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findAllByText(mn.validation.required)).toHaveLength(2);
    expect(dialog.getByText(mn.validation.phone)).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')).toHaveLength(0);

    await user.type(dialog.getByLabelText(mn.customerApp.contacts.role), 'Агуулах, хүргэлт');
    await user.type(dialog.getByLabelText(mn.customerApp.contacts.name), ' Бат ');
    const phone = dialog.getByLabelText(mn.customerApp.contacts.phone);
    await user.clear(phone);
    await user.type(phone, '9500 1122');
    await user.click(dialog.getByRole('switch', { name: mn.customerApp.contacts.shown }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')[0])).toEqual({
      contacts: [
        request(ORDERS),
        { role: 'Агуулах, хүргэлт', name: 'Бат', phone: '+97695001122', shown: false },
      ],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.customerApp.contacts.saved);
    expect(await card.findByText('Бат')).toBeInTheDocument();
  });

  it('moves a contact down, edits one and removes one, each saving the list', async () => {
    let list = [ORDERS, ACCOUNTANT];
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/customer/contacts': () => json(list),
      'PUT /api/v1/customer/contacts': async (put) => {
        const { contacts } = (await put.clone().json()) as {
          contacts: Schemas['CompanyContactRequest'][];
        };
        // Keep the ids by name, as the server keeps its rows.
        list = contacts.map((contact) => ({
          id: contact.name === 'Сараа' ? 1 : 2,
          ...contact,
        }));
        return json(list);
      },
    });
    renderApp('/app/contacts', fetchMock);
    const user = userEvent.setup();
    const card = await contactsCard();
    await card.findByText('Сараа');
    const up = `${mn.customerApp.contacts.up}: `;
    const down = `${mn.customerApp.contacts.down}: `;
    // The first row cannot go up, the last cannot go down.
    expect(card.getByRole('button', { name: `${up}Сараа` })).toBeDisabled();
    expect(card.getByRole('button', { name: `${down}Болд` })).toBeDisabled();

    await user.click(card.getByRole('button', { name: `${down}Сараа` }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')[0])).toEqual({
      contacts: [request(ACCOUNTANT), request(ORDERS)],
    });
    await waitFor(() => expect(card.getByRole('button', { name: `${up}Болд` })).toBeDisabled());

    await user.click(
      card.getByRole('button', { name: mn.common.editRecord.replace('{{name}}', 'Болд') }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.customerApp.contacts.editTitle }),
    );
    expect(dialog.getByLabelText(mn.customerApp.contacts.phone)).toHaveValue('88112233');
    await user.click(dialog.getByRole('switch', { name: mn.customerApp.contacts.shown }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')[1])).toEqual({
      contacts: [{ ...request(ACCOUNTANT), shown: true }, request(ORDERS)],
    });

    await user.click(
      card.getByRole('button', { name: `${mn.customerApp.contacts.remove}: Сараа` }),
    );
    const confirm = within(
      await screen.findByRole('dialog', {
        name: mn.customerApp.contacts.removeTitle.replace('{{name}}', 'Сараа'),
      }),
    );
    await user.click(confirm.getByRole('button', { name: mn.customerApp.contacts.remove }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer/contacts')[2])).toEqual({
      contacts: [{ ...request(ACCOUNTANT), shown: true }],
    });
    await waitFor(() => expect(card.queryByText('Сараа')).toBeNull());
  });

  it('shows a refusal inside the dialog and keeps it open', async () => {
    renderApp(
      '/app/contacts',
      signedIn(ADMIN_ME, {
        'GET /api/v1/customer/contacts': () => json([]),
        'PUT /api/v1/customer/contacts': () => problem('VALIDATION_FAILED', 422),
      }),
    );
    const user = userEvent.setup();
    const card = await contactsCard();
    expect(await card.findByText(mn.customerApp.contacts.empty)).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: mn.customerApp.contacts.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.customerApp.contacts.role), 'Оффис');
    await user.type(dialog.getByLabelText(mn.customerApp.contacts.name), 'Сараа');
    await user.type(dialog.getByLabelText(mn.customerApp.contacts.phone), '99112233');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.errors.VALIDATION_FAILED)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
