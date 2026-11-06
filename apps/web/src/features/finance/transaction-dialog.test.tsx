import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls } from '@/test/inventory-fixtures';
import { choose } from '@/test/choose';
import { json, renderApp, signedIn } from '@/test/render-app';
import { ACCOUNTS, ENTRY } from './finance-fixtures';

const POST = '/api/v1/journal-entries/by-account';
const words = mn.finance.transactions;
const bank = { ...ACCOUNTS[0], id: 90, code: '110102', name: 'Харилцах', journal: 'BANK' };
const routes = () => ({
  'GET /api/v1/gl-accounts': () => json([bank, ...ACCOUNTS]),
  'GET /api/v1/customers': () =>
    json({ data: [{ id: 9, code: '0009', name: 'Номин дэлгүүр' }], nextCursor: null }),
  'GET /api/v1/journal-entries': () => json({ data: [], nextCursor: null }),
  [`POST ${POST}`]: () => json(ENTRY, 201),
});
const open = async (fetchMock: ReturnType<typeof signedIn>) => {
  renderApp('/finance/transactions?journal=BANK&new=1', fetchMock);
  return within(await screen.findByRole('dialog'));
};
const pick = (
  user: ReturnType<typeof userEvent.setup>,
  dialog: ReturnType<typeof within>,
  label: string,
  name: RegExp,
) => choose(user, dialog.getByLabelText(label), name);
const counterId = ACCOUNTS.find((row) => row.code === '511020')?.id ?? 0;
const counterLabel = ACCOUNTS.find((row) => row.id === counterId);

describe('«Шинэ гүйлгээ» (ADR-0150)', () => {
  it('«Хадгалаад шинэ» keeps the account, clears the amount and takes a new key', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    const dialog = await open(fetchMock);
    await pick(user, dialog, words.account, /^110102/);
    await pick(user, dialog, words.counterAccount, /^511020/);
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '5000');
    await user.type(dialog.getByLabelText(mn.finance.fields.description), 'Эхний');
    await user.click(dialog.getByRole('button', { name: mn.common.saveAndNew }));

    await waitFor(() => expect(calls(fetchMock, 'POST', POST)).toHaveLength(1));
    await waitFor(() => expect(dialog.getByLabelText(mn.finance.fields.amount)).toHaveValue(''));
    expect(dialog.getByLabelText(mn.finance.fields.description)).toHaveValue('');
    expect(dialog.getByLabelText(words.account)).toHaveValue('110102 · Харилцах');
    expect(dialog.getByLabelText(words.counterAccount)).toHaveValue(
      `${counterLabel?.code} · ${counterLabel?.name}`,
    );
    expect(dialog.getByLabelText(mn.finance.fields.amount)).toHaveFocus();
    // What the save kept is not work to lose: the dialog closes without asking.
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '700');
    await user.type(dialog.getByLabelText(mn.finance.fields.description), 'Дараах');
    await user.click(dialog.getByRole('button', { name: mn.common.saveAndNew }));
    await waitFor(() => expect(calls(fetchMock, 'POST', POST)).toHaveLength(2));
    const [first, second] = calls(fetchMock, 'POST', POST);
    expect(await bodyOf(first)).toMatchObject({ amount: '5000', accountId: 90, side: 'DEBIT' });
    expect(await bodyOf(second)).toMatchObject({ amount: '700', accountId: 90 });
    expect(first?.headers.get('Idempotency-Key')).not.toBe(second?.headers.get('Idempotency-Key'));
    await waitFor(() => expect(dialog.getByLabelText(mn.finance.fields.amount)).toHaveValue(''));
    await user.click(dialog.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks before dropping what was typed, and an outside click does nothing', async () => {
    const user = userEvent.setup();
    const dialog = await open(signedIn(ACCOUNTANT_ME, routes()));
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '5000');

    fireEvent.pointerDown(document.body);
    expect(dialog.getByLabelText(mn.finance.fields.amount)).toHaveValue('5,000');
    expect(screen.queryByText(mn.common.discard.title)).toBeNull();

    await user.click(dialog.getByRole('button', { name: mn.common.cancel }));
    const asked = within(await screen.findByRole('dialog', { name: mn.common.discard.title }));
    await user.click(asked.getByRole('button', { name: mn.common.discard.keep }));
    await waitFor(() => expect(screen.queryByText(mn.common.discard.title)).toBeNull());
    expect(screen.getByLabelText(mn.finance.fields.amount)).toHaveValue('5,000');

    await user.keyboard('{Escape}');
    const again = within(await screen.findByRole('dialog', { name: mn.common.discard.title }));
    await user.click(again.getByRole('button', { name: mn.common.discard.confirm }));
    await waitFor(() => expect(screen.queryByLabelText(mn.finance.fields.amount)).toBeNull());
  });

  it('«Шилжүүлэг» shrinks the first account and asks a party only when one is needed', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    renderApp('/finance/transactions?journal=BANK&transfer=1', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByText(words.partyOptional)).toBeNull();
    expect(dialog.queryByText(words.withVat)).toBeNull();
    await pick(user, dialog, words.transfer.from, /^110102/);
    await pick(user, dialog, words.transfer.to, /^511020/);
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '300');
    await user.type(dialog.getByLabelText(mn.finance.fields.description), 'Дансны шилжүүлэг');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', POST)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', POST)[0])).toMatchObject({
      accountId: 90,
      counterAccountId: counterId,
      side: 'CREDIT',
      amount: '300',
      withVat: false,
    });
  });

  it('offers a party on every new transaction', async () => {
    const dialog = await open(signedIn(ACCOUNTANT_ME, routes()));
    expect(dialog.getByText(words.partyOptional)).toBeInTheDocument();
    // The work starts at the account, not the date (ADR-0155).
    await waitFor(() => expect(dialog.getByLabelText(words.account)).toHaveFocus());
  });

  it('shows both sides of the entry before it is saved (ADR-0155)', async () => {
    const user = userEvent.setup();
    const dialog = await open(signedIn(ACCOUNTANT_ME, routes()));
    const preview = mn.finance.transactions.preview;
    expect(dialog.queryByRole('group', { name: preview })).toBeNull();
    await pick(user, dialog, words.account, /^110102/);
    await pick(user, dialog, words.counterAccount, /^511020/);
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '5000');
    const shown = within(dialog.getByRole('group', { name: preview }));
    // Money in: the bank is debited.
    expect(shown.getByText(/110102/).parentElement).toHaveTextContent(/^Дт.*5,000/);
    expect(shown.getByText(/511020/).parentElement).toHaveTextContent(/^Кт.*5,000/);
  });

  it('groups the amount as it is typed and sends it plain', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    const dialog = await open(fetchMock);
    await pick(user, dialog, words.account, /^110102/);
    await pick(user, dialog, words.counterAccount, /^511020/);
    const amount = dialog.getByLabelText(mn.finance.fields.amount);
    await user.type(amount, '1000000');
    expect(amount).toHaveValue('1,000,000');
    // Letters and a third decimal do not get in; a typed middle digit keeps the caret after it.
    await user.type(amount, 'a.257');
    expect(amount).toHaveValue('1,000,000.25');
    await user.clear(amount);
    await user.type(amount, '1234');
    await user.type(amount, '9', { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(amount).toHaveValue('19,234');
    expect((amount as HTMLInputElement).selectionStart).toBe(2);
    await user.type(dialog.getByLabelText(mn.finance.fields.description), 'Дүн');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', POST)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', POST)[0])).toMatchObject({ amount: '19234' });
  });

  it('finds an account by typing its code or name, and Enter takes the row', async () => {
    const user = userEvent.setup();
    const dialog = await open(signedIn(ACCOUNTANT_ME, routes()));
    const counter = dialog.getByLabelText(words.counterAccount);
    await waitFor(() => expect(counter).toBeEnabled());
    await user.click(counter);
    await screen.findByRole('option', { name: /^110102/ });
    await user.keyboard('5110');
    await waitFor(() => expect(screen.queryByRole('option', { name: /^110102/ })).toBeNull());
    await screen.findByRole('option', { name: /^511020/ });
    await user.keyboard('{Enter}');
    expect(counter).toHaveValue(`${counterLabel?.code} · ${counterLabel?.name}`);
    expect(screen.queryByRole('option')).toBeNull();
    // The choice stays selected: the next letters start a new search.
    await user.keyboard('1101');
    expect(counter).toHaveValue('1101');
    await screen.findByRole('option', { name: /^110102/ });
  });

  it('finds a party by typing, without a list before the first letter', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    const dialog = await open(fetchMock);
    await pick(user, dialog, words.account, /^110102/);
    await pick(user, dialog, words.counterAccount, /^511020/);
    await user.type(dialog.getByLabelText(mn.finance.fields.amount), '100');
    await user.type(dialog.getByLabelText(mn.finance.fields.description), 'Хүнтэй');
    const party = dialog.getByLabelText(words.partyOptional);
    await user.click(party);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('Номин');
    await screen.findByRole('option', { name: /Номин дэлгүүр/ });
    await user.keyboard('{Enter}');
    expect(party).toHaveValue('Номин дэлгүүр · 0009');

    await user.click(dialog.getByRole('button', { name: mn.common.clear }));
    expect(party).toHaveValue('');
    await user.click(party);
    await user.keyboard('Номин');
    await user.click(await screen.findByRole('option', { name: /Номин дэлгүүр/ }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', POST)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', POST)[0])).toMatchObject({
      party: { customerId: 9 },
    });
  });

  it('closes at once with nothing typed', async () => {
    const user = userEvent.setup();
    const dialog = await open(signedIn(ACCOUNTANT_ME, routes()));
    await user.click(dialog.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(mn.common.discard.title)).toBeNull();
  });
});
