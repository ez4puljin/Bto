import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-11-06T05:00:00.000Z';
const T = mn.aiSettings;

const SETTINGS: Schemas['AiSettings'] = {
  source: 'SETTINGS',
  enabled: true,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  baseUrl: null,
  keyHint: 'WXYZ',
  keyUnreadable: false,
  secretReady: true,
  readerReady: true,
  priceInputPerMtok: '2',
  priceOutputPerMtok: '10',
  monthlyBudgetUsd: '20.00',
  userDailyQuestions: null,
  updatedAt: STAMP,
  updatedBy: 'Админ Бат',
};

const USAGE: Schemas['AiUsage'] = {
  connection: {
    state: 'CONNECTED',
    source: 'SETTINGS',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    reason: null,
    status: null,
    providerCode: null,
    checkedAt: STAMP,
    lastFailure: null,
  },
  today: {
    questions: 2,
    invoiceChecks: 0,
    productReads: 4,
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: '0.004000',
    unpricedCalls: 0,
  },
  month: {
    questions: 40,
    invoiceChecks: 3,
    productReads: 25,
    inputTokens: 500000,
    outputTokens: 20000,
    costUsd: '17.250000',
    unpricedCalls: 0,
  },
  budget: { state: 'WARN', limitUsd: '20.00', spentUsd: '17.250000' },
  byUser: [
    {
      userId: 7,
      fullName: 'Бат',
      questions: 40,
      invoiceChecks: 3,
      inputTokens: 500000,
      outputTokens: 20000,
      costUsd: '17.250000',
    },
  ],
  userDailyQuestions: 30,
};

const ROLES = [
  { id: 1, code: 'ADMIN', name: null, isSystem: true, permissions: ['ai.ask'], userCount: 2 },
  { id: 2, code: 'OFFICE', name: null, isSystem: true, permissions: [], userCount: 2 },
  {
    id: 9,
    code: null,
    name: 'Агуулахын ахлах',
    isSystem: false,
    permissions: ['ai.ask'],
    userCount: 1,
  },
];

const PICTURE: Schemas['PictureSettings'] = {
  keyHint: null,
  keyUnreadable: false,
  secretReady: true,
  stampUrl: null,
  updatedAt: null,
  updatedBy: null,
};

const ROUTES = {
  'GET /api/v1/ai/picture-settings': () => json(PICTURE),
  'GET /api/v1/settings': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/ai/settings': () => json(SETTINGS),
  'GET /api/v1/ai/usage': () => json(USAGE),
  'GET /api/v1/roles': () => json({ data: ROLES, nextCursor: null }),
  'PATCH /api/v1/ai/settings': () => json(SETTINGS),
  'PATCH /api/v1/roles/9': () => json(ROLES[2]),
};
/** Reads the settings, without the AI's. */
const SETTINGS_READER = {
  ...ADMIN_ME,
  permissions: ADMIN_ME.permissions.filter((code) => code !== 'ai.settings.manage'),
};

describe('«Тохиргоо → AI» (ADR-0162)', () => {
  it('says the AI only reads and shows only the end of the key', async () => {
    renderApp('/settings?tab=ai', signedIn(ADMIN_ME, ROUTES));
    expect(await screen.findByText('••••WXYZ')).toBeInTheDocument();
    expect(screen.getByText(T.readOnly)).toBeInTheDocument();
    expect(screen.getByText(T.connection.sources.SETTINGS)).toBeInTheDocument();
  });

  it('sends a typed key once and does not keep it on the screen', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, ROUTES);
    renderApp('/settings?tab=ai', fetchMock);
    const card = await screen.findByRole('region', { name: T.connection.title });
    await user.click(within(card).getByRole('button', { name: /Засах/ }));
    await user.type(within(card).getByLabelText(T.connection.key), 'test-key-not-real-0000');
    await user.click(within(card).getByRole('button', { name: mn.common.save }));

    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/ai/settings')).toHaveLength(1));
    const [request] = calls(fetchMock, 'PATCH', '/api/v1/ai/settings');
    expect(await bodyOf(request)).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: 'test-key-not-real-0000',
    });
    await waitFor(() => expect(screen.queryByLabelText(T.connection.key)).toBeNull());
    expect(document.body.textContent).not.toContain('test-key-not-real-0000');
  });

  it('lets a custom role choose its data; ADMIN and the other system roles stay as they are', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, ROUTES);
    renderApp('/settings?tab=ai', fetchMock);
    const stock = T.rights.groups.stock;
    const custom = await screen.findByRole('checkbox', { name: `Агуулахын ахлах: ${stock}` });
    expect(
      screen.getByRole('checkbox', { name: `${mn.roles.system.ADMIN}: ${stock}` }),
    ).toBeDisabled();
    expect(screen.queryByText(mn.roles.system.OFFICE)).toBeNull();

    await user.click(custom);
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/roles/9')).toHaveLength(1));
    const [request] = calls(fetchMock, 'PATCH', '/api/v1/roles/9');
    expect(await bodyOf(request)).toEqual({ permissions: ['ai.ask', 'ai.data.stock'] });
  });

  it('checks a typed background service key for free, saves it once and forgets it (ADR-0198)', async () => {
    const user = userEvent.setup();
    const P = T.picture;
    const key = 'test-picture-key-not-real-WXYZ';
    let saved = PICTURE;
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/ai/picture-settings': () => json(saved),
      'POST /api/v1/ai/picture-settings/test': () =>
        json({
          ok: true,
          reason: null,
          status: null,
          providerCode: null,
          credits: '42',
          freeCalls: 50,
        }),
      'PATCH /api/v1/ai/picture-settings': () => {
        saved = { ...PICTURE, keyHint: 'WXYZ' };
        return json(saved);
      },
    });
    renderApp('/settings?tab=ai', fetchMock);
    const card = await screen.findByRole('region', { name: P.title });
    expect(await within(card).findByText(P.logoNone)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: P.test })).toBeDisabled();

    await user.type(within(card).getByLabelText(P.key), key);
    await user.click(within(card).getByRole('button', { name: P.test }));
    expect(await within(card).findByText(P.testOk)).toBeInTheDocument();
    expect(within(card).getByText('Үлдсэн кредит: 42')).toBeInTheDocument();
    const [checked] = calls(fetchMock, 'POST', '/api/v1/ai/picture-settings/test');
    expect(await bodyOf(checked)).toEqual({ apiKey: key });
    expect(calls(fetchMock, 'PATCH', '/api/v1/ai/picture-settings')).toHaveLength(0);

    await user.click(within(card).getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/ai/picture-settings')).toHaveLength(1),
    );
    const [patched] = calls(fetchMock, 'PATCH', '/api/v1/ai/picture-settings');
    expect(await bodyOf(patched)).toEqual({ apiKey: key });
    await waitFor(() => expect(within(card).getByLabelText(P.key)).toHaveValue(''));
    expect(await within(card).findByText(/Хадгалсан \(…WXYZ\)/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: P.keyRemove })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(key);
  });

  it('explains a wrong background service key in words', async () => {
    const user = userEvent.setup();
    const P = T.picture;
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/ai/picture-settings': () => json({ ...PICTURE, keyHint: 'WXYZ' }),
      'POST /api/v1/ai/picture-settings/test': () =>
        json({
          ok: false,
          reason: 'HTTP',
          status: 403,
          providerCode: 'auth_failed',
          credits: null,
          freeCalls: null,
        }),
    });
    renderApp('/settings?tab=ai', fetchMock);
    const card = await screen.findByRole('region', { name: P.title });
    await user.click(await within(card).findByRole('button', { name: P.test }));
    expect(await within(card).findByText(P.failed.badKey)).toBeInTheDocument();
    const [checked] = calls(fetchMock, 'POST', '/api/v1/ai/picture-settings/test');
    expect(await bodyOf(checked)).toEqual({});
  });

  it('is a tab only for who manages the AI', async () => {
    renderApp('/settings?tab=ai', signedIn(SETTINGS_READER, ROUTES));
    await screen.findByRole('heading', { name: mn.settings.title });
    expect(screen.queryByText(T.readOnly)).toBeNull();
  });
});

describe('«Системийн төлөв»: the AI (ADR-0162)', () => {
  it('shows the connection, the cost and the limit, and where the credit is', async () => {
    renderApp('/system/status', signedIn(ADMIN_ME, ROUTES));
    const card = await screen.findByRole('region', { name: mn.systemStatus.ai.title });
    expect(await within(card).findByText(mn.systemStatus.ai.states.CONNECTED)).toBeInTheDocument();
    expect(within(card).getByText(mn.systemStatus.ai.budgetStates.WARN)).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '86.3');
    expect(within(card).getByText('$17.25 / $20.00')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: mn.systemStatus.ai.billing })).toHaveAttribute(
      'href',
      'https://platform.claude.com/settings/billing',
    );
  });

  it('explains an empty account in plain words', async () => {
    renderApp(
      '/system/status',
      signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/ai/usage': () =>
          json({
            ...USAGE,
            connection: {
              ...USAGE.connection,
              lastFailure: {
                reason: 'HTTP',
                status: 400,
                providerCode: 'credit_balance_too_low',
                at: STAMP,
              },
            },
          }),
      }),
    );
    expect(
      await screen.findByText(new RegExp(mn.systemStatus.ai.failures.credit)),
    ).toBeInTheDocument();
  });

  it('is hidden from people without the right', async () => {
    renderApp('/system/status', signedIn(WORKER_ME, ROUTES));
    await screen.findByRole('heading', { name: mn.systemStatus.title });
    expect(screen.queryByRole('region', { name: mn.systemStatus.ai.title })).toBeNull();
  });
});
