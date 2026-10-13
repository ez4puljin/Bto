import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  json,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-13T05:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SQL = 'SELECT name AS "Бараа", sum(stock_value) AS "Үнэлгээ" FROM stock GROUP BY 1';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const READY: Schemas['AiStatus'] = {
  configured: true,
  database: true,
  provider: 'openai',
  model: 'test-model',
};

const question = (overrides: Partial<Schemas['AiQuestion']> = {}): Schemas['AiQuestion'] => ({
  id: 41,
  conversationId: 9,
  question: 'Аль бараа хамгийн их үнэлгээтэй вэ?',
  status: 'ANSWERED',
  kind: 'QUERY',
  sql: SQL,
  explanation: 'Үлдэгдлийн үнэлгээгээр эрэмбэлэв.',
  summary: 'Кока кола хамгийн их үнэлгээтэй байна.',
  errorCode: null,
  rowCount: 2,
  truncated: false,
  repaired: false,
  createdAt: STAMP,
  ...overrides,
});

const RESULT: Schemas['AiResult'] = {
  columns: [
    { name: 'Бараа', kind: 'text' },
    { name: 'Үнэлгээ', kind: 'number' },
  ],
  rows: [
    ['Кока кола', '1234567.50'],
    ['Ус', '48000.00'],
  ],
  truncated: false,
};

const conversation = (questions: Schemas['AiQuestion'][]) =>
  json({
    conversation: { id: 9, title: 'Үнэлгээ', createdAt: STAMP, updatedAt: STAMP },
    questions,
  });

const REPORT: Schemas['AiReport'] = {
  id: 5,
  name: 'Үнэлгээ',
  sql: SQL,
  sourceQuestionId: 41,
  createdBy: { id: 1, fullName: 'Админ Бат' },
  createdAt: STAMP,
  updatedAt: STAMP,
  canChange: true,
};

const AI_ROUTES = {
  'GET /api/v1/ai/status': () => json(READY),
  'GET /api/v1/ai/conversations': () => list([]),
};

describe('AI assistant pages (ADR-0045)', () => {
  it('shows the AI menu to holders of ai.ask only', async () => {
    renderApp('/', signedIn(ADMIN_ME, AI_ROUTES));
    const menu = await findSidebar();
    expect(within(menu).getByRole('link', { name: mn.nav.aiAssistant })).toHaveAttribute(
      'href',
      '/ai',
    );
    expect(within(menu).getByRole('link', { name: mn.nav.aiReports })).toHaveAttribute(
      'href',
      '/ai/reports',
    );
    expect(await screen.findByRole('link', { name: mn.home.actions.askAi })).toBeInTheDocument();
  });

  it('hides the assistant from people without ai.ask', async () => {
    renderApp('/', signedIn(WORKER_ME, AI_ROUTES));
    const menu = await findSidebar();
    expect(within(menu).queryByRole('link', { name: mn.nav.aiAssistant })).toBeNull();
    expect(screen.queryByRole('link', { name: mn.home.actions.askAi })).toBeNull();
  });

  it('explains what to set while the assistant is not configured', async () => {
    renderApp(
      '/ai',
      signedIn(ADMIN_ME, {
        ...AI_ROUTES,
        'GET /api/v1/ai/status': () =>
          json({ configured: false, database: false, provider: null, model: null }),
      }),
    );
    expect(await screen.findByText(mn.ai.notConfigured.title)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: mn.ai.placeholder })).toBeDisabled();
  });

  it('asks a question and shows the summary, the table and the folded SQL', async () => {
    let body: unknown = null;
    let key: string | null = null;
    const fetchMock = signedIn(ADMIN_ME, {
      ...AI_ROUTES,
      'POST /api/v1/ai/questions': async (request) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return json({ conversationId: 9, question: question(), result: RESULT }, 201);
      },
      'GET /api/v1/ai/conversations/9': () => conversation([question()]),
    });
    renderApp('/ai', fetchMock);
    const user = userEvent.setup();

    // An example fills the box; Enter sends it.
    await user.click(await screen.findByRole('button', { name: mn.ai.examples.topStockValue }));
    const box = screen.getByRole('textbox', { name: mn.ai.placeholder });
    expect(box).toHaveValue(mn.ai.examples.topStockValue);
    await user.clear(box);
    await user.type(box, 'Аль бараа хамгийн их үнэлгээтэй вэ?{Enter}');

    expect(await screen.findByText('Кока кола хамгийн их үнэлгээтэй байна.')).toBeInTheDocument();
    expect(body).toEqual({ question: 'Аль бараа хамгийн их үнэлгээтэй вэ?' });
    expect(key).toMatch(UUID);
    const table = screen.getByRole('table', { name: 'Аль бараа хамгийн их үнэлгээтэй вэ?' });
    expect(within(table).getByRole('cell', { name: '1,234,567.50' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '48,000' })).toBeInTheDocument();
    expect(screen.getByText(mn.ai.answer.howComputed)).toBeInTheDocument();
    expect(screen.getByText(SQL)).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('says the first request is still running instead of showing an error', async () => {
    renderApp(
      '/ai',
      signedIn(ADMIN_ME, {
        ...AI_ROUTES,
        'POST /api/v1/ai/questions': () => problem('IDEMPOTENCY_KEY_IN_PROGRESS', 409),
      }),
    );
    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: mn.ai.placeholder });
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'Үлдэгдэл?{Enter}');
    expect(await screen.findByText(mn.ai.stillWorking)).toBeInTheDocument();
    expect(screen.queryByText(mn.errors.IDEMPOTENCY_KEY_IN_PROGRESS)).toBeNull();
  });

  it('runs an older answer again for its rows and explains a failed one', async () => {
    let ran = 0;
    renderApp(
      '/ai?c=9',
      signedIn(ADMIN_ME, {
        ...AI_ROUTES,
        'GET /api/v1/ai/conversations/9': () =>
          conversation([
            question(),
            question({
              id: 42,
              question: 'Бүх хөдөлгөөн?',
              status: 'FAILED',
              summary: null,
              errorCode: '57014',
              rowCount: null,
            }),
          ]),
        'POST /api/v1/ai/questions/41/run': () => {
          ran += 1;
          return json(RESULT);
        },
      }),
    );
    const user = userEvent.setup();
    expect(await screen.findByText(mn.ai.reasons.TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText(mn.ai.statuses.FAILED)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.ai.answer.showTable }));
    expect(await screen.findByRole('cell', { name: '1,234,567.50' })).toBeInTheDocument();
    expect(ran).toBe(1);
  });

  it('saves an answer as a report under the name typed', async () => {
    let saved: unknown = null;
    renderApp(
      '/ai?c=9',
      signedIn(ADMIN_ME, {
        ...AI_ROUTES,
        'GET /api/v1/ai/conversations/9': () => conversation([question()]),
        'POST /api/v1/ai/reports': async (request) => {
          saved = await request.json();
          return json(REPORT, 201);
        },
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.ai.answer.saveAsReport }));
    const dialog = within(await screen.findByRole('dialog'));
    const name = dialog.getByLabelText(mn.ai.report.nameLabel);
    expect(name).toHaveValue('Аль бараа хамгийн их үнэлгээтэй вэ?');
    await user.clear(name);
    await user.type(name, 'Үнэлгээ');
    await user.click(dialog.getByRole('button', { name: mn.ai.report.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(mn.ai.report.saved);
    expect(saved).toEqual({ questionId: 41, name: 'Үнэлгээ' });
  });
});

describe('saved AI reports', () => {
  it('runs a report, and lets only its author rename or delete it', async () => {
    let deleted = false;
    renderApp(
      '/ai/reports',
      signedIn(ADMIN_ME, {
        ...AI_ROUTES,
        'GET /api/v1/ai/reports': () =>
          list(
            deleted
              ? [{ ...REPORT, id: 6, name: 'Бусдынх', canChange: false }]
              : [REPORT, { ...REPORT, id: 6, name: 'Бусдынх', canChange: false }],
          ),
        'POST /api/v1/ai/reports/5/run': () => json(RESULT),
        'DELETE /api/v1/ai/reports/5': () => {
          deleted = true;
          return new Response(null, { status: 204 });
        },
      }),
    );
    const user = userEvent.setup();
    expect(
      await screen.findByRole('button', { name: `${mn.ai.report.rename}: Үнэлгээ` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${mn.ai.report.rename}: Бусдынх` })).toBeNull();
    expect(
      screen.getByRole('button', { name: `${mn.ai.report.run}: Бусдынх` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${mn.ai.report.run}: Үнэлгээ` }));
    expect(await screen.findByRole('cell', { name: '1,234,567.50' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${mn.ai.report.delete}: Үнэлгээ` }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.ai.report.delete }));
    expect(await screen.findByRole('status')).toHaveTextContent(mn.ai.report.deleted);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `${mn.ai.report.run}: Үнэлгээ` })).toBeNull(),
    );
  });

  it('points to the assistant while there is no report', async () => {
    renderApp(
      '/ai/reports',
      signedIn(ADMIN_ME, { ...AI_ROUTES, 'GET /api/v1/ai/reports': () => list([]) }),
    );
    const empty = (await screen.findByText(mn.ai.report.empty)).parentElement;
    if (!empty) throw new Error('no empty state');
    expect(within(empty).getByRole('link', { name: mn.nav.aiAssistant })).toHaveAttribute(
      'href',
      '/ai',
    );
  });
});
