import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
type Handler = (request: Request) => Response | Promise<Response>;

const STAMP = '2026-11-01T02:00:00.000Z';
const texts = mn.hr.community;
const HR_USER: Me = {
  ...ADMIN_ME,
  id: 20,
  username: 'hr1',
  fullName: 'Хүний нөөц Оюун',
  permissions: ['hr.attendance.view', 'hr.attendance.manage'],
  roles: [{ id: 9, code: 'HR', name: null, isSystem: true }],
};
const VIEWER: Me = {
  ...HR_USER,
  id: 21,
  username: 'viewer',
  permissions: ['hr.attendance.view'],
  roles: [],
};

const person = (fields: Partial<Schemas['HrStaff']>): Schemas['HrStaff'] => ({
  userId: 7,
  fullName: 'Дорж Бат',
  firstName: 'Бат',
  lastName: 'Дорж',
  phone: '+97699112233',
  status: 'ACTIVE',
  roles: ['WAREHOUSE'],
  position: 'Нярав',
  divisionId: null,
  divisionName: null,
  employmentType: 'PERMANENT',
  gender: null,
  employedOn: null,
  leftOn: null,
  leftReason: null,
  photoUrl: null,
  scheduleId: null,
  scheduleName: null,
  tracked: true,
  lastLoginAt: null,
  lockedUntil: null,
  passwordSet: true,
  birthDate: null,
  education: null,
  maritalStatus: null,
  district: null,
  jobLevel: null,
  leftReasonKind: null,
  children: [],
  ...fields,
});
const BAT = person({});
const SARAA = person({ userId: 8, fullName: 'Сараа Цэцэг', firstName: 'Цэцэг', lastName: 'Сараа' });

const message = (fields: Partial<Schemas['HrMessage']>): Schemas['HrMessage'] => ({
  id: 1,
  kind: 'NOTICE',
  title: 'Цалингийн өдөр',
  body: 'Цалин 25-нд орно',
  category: null,
  imageUrl: null,
  popup: true,
  publishAt: STAMP,
  withdrawnAt: null,
  createdByName: 'Хүний нөөц Оюун',
  createdAt: STAMP,
  userIds: [],
  recipients: 12,
  reads: 5,
  ...fields,
});

const VOTE: Schemas['HrPoll'] = {
  id: 3,
  kind: 'VOTE',
  title: 'Шинэ жилийн үдэшлэг хаана?',
  note: null,
  imageUrl: null,
  showResults: true,
  allowChange: false,
  anonymous: false,
  startsAt: STAMP,
  endsAt: null,
  closedAt: null,
  open: true,
  createdByName: 'Хүний нөөц Оюун',
  createdAt: STAMP,
  userIds: [],
  recipients: 10,
  respondents: 4,
  answered: false,
  resultsShown: true,
  questions: [
    {
      id: 30,
      text: 'Шинэ жилийн үдэшлэг хаана?',
      kind: 'SINGLE',
      required: true,
      texts: [],
      average: null,
      answered: 4,
      mine: { optionIds: [], text: null, value: null },
      options: [
        { id: 301, text: 'Ресторан', count: 3, voters: ['Дорж Бат', 'Сараа Цэцэг', 'Оюун'] },
        { id: 302, text: 'Оффис', count: 1, voters: ['Болд'] },
      ],
    },
  ],
};

const FEEDBACK: Schemas['HrFeedback'][] = [
  {
    id: 11,
    userId: 7,
    fullName: 'Дорж Бат',
    category: 'SUGGESTION',
    title: 'Цайны газар',
    body: 'Цайны газар нээгээч',
    status: 'NEW',
    reply: null,
    createdAt: STAMP,
  },
  {
    id: 12,
    userId: null,
    fullName: null,
    category: 'COMPLAINT',
    title: 'Даарч байна',
    body: 'Агуулах хүйтэн',
    status: 'NEW',
    reply: null,
    createdAt: STAMP,
  },
];

const SITE: Schemas['WorkSite'] = {
  id: 1,
  name: 'Төв агуулах',
  lat: '49.634500',
  lng: '100.162300',
  radiusM: 150,
  branchId: null,
  branchName: null,
  archivedAt: null,
  updatedAt: STAMP,
};
const SITE_TWO: Schemas['WorkSite'] = { ...SITE, id: 2, name: 'Супермаркет', radiusM: 80 };

const SCHEDULE: Schemas['HrSchedule'] = {
  workStart: '09:00',
  workEnd: '18:00',
  graceMinutes: 10,
  workdays: '1111110',
  updatedAt: STAMP,
};
const employee = (fields: Partial<Schemas['HrEmployee']>): Schemas['HrEmployee'] => ({
  userId: 7,
  fullName: 'Дорж Бат',
  phone: null,
  status: 'ACTIVE',
  roles: [],
  tracked: true,
  workStart: null,
  workEnd: null,
  graceMinutes: null,
  workdays: null,
  siteIds: [],
  schedule: SCHEDULE,
  ...fields,
});

const routes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  'GET /api/v1/hr/staff': () => json([BAT, SARAA]),
  'GET /api/v1/hr/messages': () => json([message({})]),
  'GET /api/v1/hr/polls': () => json([VOTE]),
  'GET /api/v1/hr/feedback': () => json(FEEDBACK),
  'GET /api/v1/hr/work-sites': () => json([SITE, SITE_TWO]),
  'GET /api/v1/hr/employees': () =>
    json([employee({ siteIds: [1] }), employee({ userId: 8, siteIds: [1] })]),
  'GET /api/v1/branches': () => json([]),
  'GET /api/v1/hr/calendar': () =>
    json([
      {
        date: `${businessDate().slice(0, 7)}-15`,
        kind: 'EVENT',
        title: 'Хамт олны өдөр',
        note: null,
        eventId: 5,
        toDate: `${businessDate().slice(0, 7)}-16`,
        userId: null,
        photoUrl: null,
        years: null,
        typeId: 1,
        typeName: 'Хамт олон',
        typeColor: '#0071e3',
        doneAt: null,
        doneByName: null,
      },
    ] satisfies Schemas['HrCalendarItem'][]),
  'GET /api/v1/hr/event-types': () =>
    json([
      { id: 1, name: 'Хамт олон', color: '#0071e3', archivedAt: null, events: 1 },
      { id: 2, name: 'Бараа буух', color: '#f97316', archivedAt: null, events: 0 },
    ] satisfies Schemas['HrEventType'][]),
  ...extra,
});

const pickPerson = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  name: string,
) => {
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
};

describe('notices and news', () => {
  it('sends a notice to the chosen people', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'POST /api/v1/hr/messages': async (request) =>
          json(message({ id: 2, ...((await request.clone().json()) as object) }), 201),
      }),
    );
    renderApp('/hr/notices', fetchMock);
    await screen.findByText('Цалингийн өдөр');
    expect(screen.getByRole('cell', { name: texts.messages.states.PUBLISHED })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: texts.messages.NOTICE.create }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(texts.messages.fields.title), 'Хурал');
    await user.type(within(dialog).getByLabelText(texts.messages.fields.body), 'Маргааш хурална');

    // «Сонгосон» with nobody chosen does not go to everybody.
    await user.click(within(dialog).getByRole('tab', { name: texts.audience.modes.CHOSEN }));
    await user.click(within(dialog).getByRole('button', { name: texts.messages.sendNow }));
    expect(await within(dialog).findByText(texts.audience.missing)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/hr/messages')).toHaveLength(0);

    await pickPerson(user, texts.audience.people, 'Сараа');
    await pickPerson(user, texts.audience.people, 'Дорж');
    await user.click(within(dialog).getByRole('button', { name: `Хасах: ${SARAA.fullName}` }));
    await pickPerson(user, texts.audience.people, 'Сараа');
    await user.click(within(dialog).getByRole('button', { name: texts.messages.sendNow }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/messages')).toHaveLength(1));
    const request = calls(fetchMock, 'POST', '/api/v1/hr/messages')[0];
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await bodyOf(request)).toMatchObject({
      kind: 'NOTICE',
      title: 'Хурал',
      body: 'Маргааш хурална',
      popup: true,
      publishAt: null,
      userIds: [7, 8],
    });
  });

  it('withdraws a notice after asking, and names the scheduled and withdrawn ones', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'GET /api/v1/hr/messages': () =>
          json([
            message({}),
            message({ id: 4, title: 'Товлосон', publishAt: '2099-01-01T00:00:00.000Z' }),
            message({ id: 6, title: 'Хуучин', withdrawnAt: STAMP }),
          ]),
        'POST /api/v1/hr/messages/1/withdraw': () => json(message({ withdrawnAt: STAMP })),
      }),
    );
    renderApp('/hr/notices', fetchMock);
    await screen.findByText('Цалингийн өдөр');
    expect(screen.getByRole('cell', { name: texts.messages.states.SCHEDULED })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '5 / 12' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Буцаах: Хуучин' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Буцаах: Цалингийн өдөр' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: texts.messages.withdraw }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/hr/messages/1/withdraw')).toHaveLength(1),
    );
  });

  it('asks a category for news and offers no pop-up', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'POST /api/v1/hr/messages': async (request) =>
          json(message({ id: 2, ...((await request.clone().json()) as object) }), 201),
      }),
    );
    renderApp('/hr/news?new=1', fetchMock);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(texts.messages.fields.popup)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(texts.messages.fields.title), 'Шинэ салбар');
    await user.type(within(dialog).getByLabelText(texts.messages.fields.body), 'Нээгдлээ');
    await user.type(within(dialog).getByLabelText(texts.messages.fields.category), 'Компани');
    await user.click(within(dialog).getByRole('button', { name: texts.messages.sendNow }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/messages')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/messages')[0])).toMatchObject({
      kind: 'NEWS',
      category: 'Компани',
      popup: false,
      userIds: [],
    });
  });
});

describe('votes and surveys', () => {
  it('creates a vote with two options and closes it, and reads the results', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'POST /api/v1/hr/polls': () => json(VOTE, 201),
        'POST /api/v1/hr/polls/3/close': () => json({ ...VOTE, open: false, closedAt: STAMP }),
      }),
    );
    renderApp('/hr/polls', fetchMock);
    await screen.findByRole('button', { name: VOTE.title });
    expect(screen.getByText('4 / 10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: texts.polls.VOTE.create }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(texts.polls.fields.voteQuestion),
      'Өдрийн хоол хэзээ?',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.create }));
    expect(await within(dialog).findByText(/2 сонголт бичнэ/)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/hr/polls')).toHaveLength(0);

    await user.type(within(dialog).getByRole('textbox', { name: 'Сонголт 1' }), '12 цаг');
    await user.type(within(dialog).getByRole('textbox', { name: 'Сонголт 2' }), '13 цаг');
    await user.click(within(dialog).getByRole('button', { name: texts.polls.fields.addOption }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Сонголт 3' }), '14 цаг');
    await user.click(within(dialog).getByRole('button', { name: 'Сонголт 3 хасах' }));
    await user.click(within(dialog).getByRole('switch', { name: texts.polls.fields.anonymous }));
    await user.click(within(dialog).getByRole('button', { name: mn.common.create }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/polls')).toHaveLength(1));
    const request = calls(fetchMock, 'POST', '/api/v1/hr/polls')[0];
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await bodyOf(request)).toMatchObject({
      kind: 'VOTE',
      title: 'Өдрийн хоол хэзээ?',
      anonymous: true,
      questions: [{ text: 'Өдрийн хоол хэзээ?', kind: 'SINGLE', options: ['12 цаг', '13 цаг'] }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: `Дуусгах: ${VOTE.title}` }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: texts.polls.close }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/hr/polls/3/close')).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: VOTE.title }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Ресторан')).toBeInTheDocument();
    expect(within(sheet).getByText('3 · 75%')).toBeInTheDocument();
    expect(within(sheet).getByText(/Сараа Цэцэг/)).toBeInTheDocument();
  });

  it('builds a survey of several kinds of question and shows text and average results', async () => {
    const user = userEvent.setup();
    const survey: Schemas['HrPoll'] = {
      ...VOTE,
      id: 9,
      kind: 'SURVEY',
      title: 'Ажлын орчин',
      anonymous: true,
      questions: [
        {
          ...VOTE.questions[0]!,
          id: 91,
          text: 'Сэтгэгдэл',
          kind: 'TEXT',
          options: [],
          texts: ['Сайхан байна'],
        },
        { ...VOTE.questions[0]!, id: 92, text: 'Оноо', kind: 'SCALE', options: [], average: '4.2' },
      ],
    };
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'GET /api/v1/hr/polls': () => json([survey]),
        'POST /api/v1/hr/polls': () => json(survey, 201),
      }),
    );
    renderApp('/hr/surveys', fetchMock);
    await user.click(await screen.findByRole('button', { name: survey.title }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Сайхан байна')).toBeInTheDocument();
    expect(within(sheet).getByText('4.2')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: mn.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: texts.polls.SURVEY.create }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(texts.polls.fields.title), 'Сэтгэл ханамж');
    await user.selectOptions(
      within(dialog).getByLabelText(texts.polls.fields.questionKind),
      'TEXT',
    );
    await user.type(within(dialog).getByLabelText(texts.polls.fields.questionText), 'Юу дутуу вэ?');
    await user.click(within(dialog).getByRole('button', { name: texts.polls.fields.addQuestion }));
    const groups = within(dialog).getAllByRole('group');
    const second = groups[groups.length - 1] as HTMLElement;
    await user.type(within(second).getByLabelText(texts.polls.fields.questionText), 'Хэр дуртай?');
    await user.selectOptions(
      within(second).getByLabelText(texts.polls.fields.questionKind),
      'SCALE',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.create }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/polls')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/polls')[0])).toMatchObject({
      kind: 'SURVEY',
      title: 'Сэтгэл ханамж',
      questions: [
        { text: 'Юу дутуу вэ?', kind: 'TEXT', options: [] },
        { text: 'Хэр дуртай?', kind: 'SCALE', options: [] },
      ],
    });
  });
});

describe('feedback', () => {
  it('reads an anonymous row as «Нэргүй» and answers one', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'PUT /api/v1/hr/feedback/11': async (request) =>
          json({ ...FEEDBACK[0], ...((await request.clone().json()) as object) }),
      }),
    );
    renderApp('/hr/feedback', fetchMock);
    await screen.findByRole('button', { name: 'Цайны газар' });
    expect(screen.getByText(texts.feedback.anonymous)).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: mn.common.search }), 'хүйтэн');
    expect(screen.queryByRole('button', { name: 'Цайны газар' })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: mn.common.search }));

    await user.click(screen.getByRole('button', { name: 'Хариулах: Цайны газар' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(texts.feedback.status), 'DONE');
    await user.type(within(dialog).getByLabelText(texts.feedback.reply), 'Нээнэ');
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/feedback/11')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/feedback/11')[0])).toEqual({
      status: 'DONE',
      reply: 'Нээнэ',
    });
  });
});

describe('a mere viewer', () => {
  it('sees the lists and no write button', async () => {
    const fetchMock = signedIn(VIEWER, routes());
    const view = renderApp('/hr/notices', fetchMock);
    await screen.findByText('Цалингийн өдөр');
    expect(screen.queryByRole('button', { name: texts.messages.NOTICE.create })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Буцаах: Цалингийн өдөр' })).toBeNull();

    await view.router.navigate('/hr/polls');
    await screen.findByRole('button', { name: VOTE.title });
    expect(screen.queryByRole('button', { name: texts.polls.VOTE.create })).toBeNull();
    expect(screen.queryByRole('button', { name: `Дуусгах: ${VOTE.title}` })).toBeNull();

    await view.router.navigate('/hr/feedback');
    await screen.findByRole('button', { name: 'Цайны газар' });
    expect(screen.queryByRole('button', { name: 'Хариулах: Цайны газар' })).toBeNull();

    await view.router.navigate('/hr/sites');
    await screen.findByText(SITE.name);
    expect(screen.queryByRole('button', { name: texts.sites.create })).toBeNull();
    expect(screen.queryByRole('button', { name: `Засах: ${SITE.name}` })).toBeNull();

    await view.router.navigate('/hr/calendar');
    await screen.findByText(new RegExp(mn.nav.hrCalendar));
    expect(screen.queryByRole('button', { name: texts.calendar.create })).toBeNull();
  });
});

describe('work sites', () => {
  it('counts each site’s people, says «Бүгд» when no one is named, and saves a typed point', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'POST /api/v1/hr/work-sites': async (request) =>
          json({ ...SITE, id: 3, ...((await request.clone().json()) as object) }, 201),
      }),
    );
    renderApp('/hr/sites', fetchMock);
    const first = (await screen.findByText(SITE.name)).closest('li') as HTMLElement;
    await within(first).findByText(/2 ажилтан/);
    const second = screen.getByText(SITE_TWO.name).closest('li') as HTMLElement;
    expect(within(second).getByText(/Бүгд/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: texts.sites.create }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(mn.hr.setup.sites.name), 'Шинэ агуулах');
    await user.type(
      within(dialog).getByLabelText(mn.hr.setup.sites.coordinates),
      '49.640000, 100.170000',
    );
    await user.clear(within(dialog).getByLabelText(mn.hr.setup.sites.radius));
    await user.type(within(dialog).getByLabelText(mn.hr.setup.sites.radius), '200');
    await user.click(within(dialog).getByRole('button', { name: mn.common.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/work-sites')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/work-sites')[0])).toMatchObject({
      name: 'Шинэ агуулах',
      radiusM: 200,
    });
  });
});

describe('the calendar', () => {
  it('lists a day of a several-day event and archives it after asking', async () => {
    const user = userEvent.setup();
    const month = businessDate().slice(0, 7);
    const fetchMock = signedIn(
      HR_USER,
      routes({ 'DELETE /api/v1/hr/events/5': () => new Response(null, { status: 204 }) }),
    );
    renderApp(`/hr/calendar?day=${month}-16`, fetchMock);
    const line = await screen.findByRole('button', { name: 'Архивлах: Хамт олны өдөр' });
    await user.click(line);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: texts.calendar.archive }));
    await waitFor(() => expect(calls(fetchMock, 'DELETE', '/api/v1/hr/events/5')).toHaveLength(1));
  });

  it('opens to a staff member without any HR right, who ticks and does not manage', async () => {
    const user = userEvent.setup();
    const month = businessDate().slice(0, 7);
    const fetchMock = signedIn(
      { ...HR_USER, id: 22, username: 'staff', permissions: [], roles: [] },
      routes({
        'PUT /api/v1/hr/events/5/done': () => json({}),
      }),
    );
    renderApp(`/hr/calendar?day=${month}-15`, fetchMock);
    await user.click(
      await screen.findByRole('checkbox', {
        name: texts.calendar.doneFor.replace('{{title}}', 'Хамт олны өдөр'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/hr/events/5/done')).toHaveLength(1),
    );
    expect(screen.queryByRole('button', { name: texts.calendar.create })).toBeNull();
    expect(screen.queryByRole('link', { name: texts.calendar.types })).toBeNull();
  });

  it('marks an event done from its line', async () => {
    const user = userEvent.setup();
    const month = businessDate().slice(0, 7);
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'PUT /api/v1/hr/events/5/done': async (request) =>
          json({ ...((await request.clone().json()) as object) }),
      }),
    );
    renderApp(`/hr/calendar?day=${month}-15`, fetchMock);
    await user.click(
      await screen.findByRole('checkbox', {
        name: texts.calendar.doneFor.replace('{{title}}', 'Хамт олны өдөр'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/hr/events/5/done')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/events/5/done')[0])).toEqual({
      done: true,
    });
  });

  it('shows only the chosen types, kept in the address, and «Бүгд» brings the rest back', async () => {
    const user = userEvent.setup();
    const month = businessDate().slice(0, 7);
    const unload: Schemas['HrCalendarItem'] = {
      date: `${month}-15`,
      kind: 'EVENT',
      title: 'Тотал ундаа буух',
      note: null,
      eventId: 6,
      toDate: null,
      userId: null,
      photoUrl: null,
      years: null,
      typeId: 2,
      typeName: 'Бараа буух',
      typeColor: '#f97316',
      doneAt: null,
      doneByName: null,
    };
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'GET /api/v1/hr/calendar': () =>
          json([
            { ...unload, eventId: 5, title: 'Хамт олны өдөр', typeId: 1, typeName: 'Хамт олон' },
            unload,
          ]),
      }),
    );
    const view = renderApp(`/hr/calendar?day=${month}-15`, fetchMock);
    const filter = await screen.findByRole('group', { name: texts.calendar.filter });
    expect(await screen.findByRole('button', { name: 'Засах: Хамт олны өдөр' })).toBeTruthy();

    await user.click(within(filter).getByRole('button', { name: /Бараа буух/ }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Засах: Хамт олны өдөр' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Засах: Тотал ундаа буух' })).toBeTruthy();
    expect(view.router.state.location.search).toContain('types=2');
    expect(
      within(filter)
        .getByRole('button', { name: /Бараа буух/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    await user.click(within(filter).getByRole('button', { name: mn.common.all }));
    expect(await screen.findByRole('button', { name: 'Засах: Хамт олны өдөр' })).toBeTruthy();
    expect(view.router.state.location.search).not.toContain('types=');
  });

  it('creates an event of two days', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'POST /api/v1/hr/events': async (request) =>
          json({ ...((await request.clone().json()) as object), date: '2026-11-20' }, 201),
      }),
    );
    renderApp('/hr/calendar?new=1', fetchMock);
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(texts.calendar.fields.kind),
      await within(dialog).findByRole('option', { name: 'Бараа буух' }),
    );
    await user.type(within(dialog).getByLabelText(texts.calendar.fields.title), 'Жилийн хурал');
    await user.click(within(dialog).getByRole('button', { name: mn.common.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/events')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/events')[0])).toMatchObject({
      typeId: 2,
      title: 'Жилийн хурал',
      fromDate: businessDate(),
      toDate: businessDate(),
    });
  });
});

describe('the home page', () => {
  const board: Schemas['AttendanceDashboard'] = {
    date: businessDate(),
    now: STAMP,
    counts: { expected: 10, present: 7, inNow: 5, late: 2, absent: 3, openIn: 0, off: 1 },
    rows: [
      {
        userId: 7,
        date: businessDate(),
        firstIn: STAMP,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 12,
        openIn: false,
        status: 'LATE',
        siteName: 'Төв агуулах',
        state: 'IN',
        fullName: 'Дорж Бат',
        roles: [],
        schedule: SCHEDULE,
      },
      {
        userId: 8,
        date: businessDate(),
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        openIn: false,
        status: 'ABSENT',
        siteName: null,
        state: null,
        fullName: 'Сараа Цэцэг',
        roles: [],
        schedule: SCHEDULE,
      },
    ],
    trend: [],
    month: [],
  };
  const homeRoutes = (extra: Record<string, Handler> = {}) =>
    routes({
      'GET /api/v1/hr/attendance/dashboard': () => json(board),
      'GET /api/v1/hr/requests': () => json([]),
      'GET /api/v1/hr/moods': () =>
        json({
          scores: [
            { score: 5, count: 4 },
            { score: 1, count: 1 },
          ],
          total: 5,
        } satisfies Schemas['HrMoods']),
      'GET /api/v1/hr/thanks': () =>
        json({
          items: [
            {
              id: 1,
              fromUserId: 8,
              fromName: 'Сараа Цэцэг',
              toUserId: 7,
              toName: 'Дорж Бат',
              toPhotoUrl: null,
              note: 'Тусалсанд баярлалаа',
              day: businessDate(),
              createdAt: STAMP,
            },
          ],
          ranking: [{ userId: 7, fullName: 'Дорж Бат', photoUrl: null, count: 3 }],
        } satisfies Schemas['HrThanks']),
      'GET /api/v1/hr/location-shares': () => json([]),
      ...extra,
    });

  it('shows the day at a glance and sends a notice at once to everybody', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      homeRoutes({
        'POST /api/v1/hr/messages': async (request) =>
          json(message({ id: 2, ...((await request.clone().json()) as object) }), 201),
      }),
    );
    renderApp('/hr/home', fetchMock);

    // The ring's figures, the arrivals (only those who came), the vote, the faces, the thanks.
    expect(await screen.findByText('7 / 10')).toBeInTheDocument();
    expect(await screen.findByText('Тусалсанд баярлалаа')).toBeInTheDocument();
    expect(await screen.findByText('Ресторан')).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: mn.hr.home.moods.faces['5'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ирц: хуудас нээх' })).toHaveAttribute(
      'href',
      '/hr/attendance',
    );
    // Only those who came are among the arrivals.
    expect(screen.queryByText('Сараа Цэцэг')).toBeNull();
    expect(screen.getByRole('img', { name: mn.hr.statuses.LATE })).toBeInTheDocument();

    await user.type(screen.getByLabelText(mn.hr.home.notice.subject), 'Хурал');
    await user.type(screen.getByLabelText(mn.hr.home.notice.body), 'Маргааш 9 цагт');
    await user.click(screen.getByRole('button', { name: mn.hr.home.notice.send }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/messages')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/messages')[0])).toMatchObject({
      kind: 'NOTICE',
      title: 'Хурал',
      userIds: [],
    });
    await waitFor(() => expect(screen.getByLabelText(mn.hr.home.notice.subject)).toHaveValue(''));
  });

  it('hides the send form from a viewer and steps through the feedback', async () => {
    const user = userEvent.setup();
    renderApp('/hr/home', signedIn(VIEWER, homeRoutes()));
    await screen.findByText('Цайны газар');
    expect(screen.queryByRole('button', { name: mn.hr.home.notice.send })).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.hr.home.feedback.older }));
    expect(await screen.findByText('Даарч байна')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(texts.feedback.anonymous))).toBeInTheDocument();
  });
});

describe('an employee’s details', () => {
  it('saves the extra facts with a child, and sends the reason kind when one leaves', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      HR_USER,
      routes({
        'PUT /api/v1/hr/staff/7/details': () => json(BAT),
        'PUT /api/v1/hr/staff/7/left': () => json(BAT),
      }),
    );
    renderApp('/hr/staff/7', fetchMock);
    const card = await screen.findByRole('region', { name: texts.details.title });
    await user.click(within(card).getByRole('button', { name: `Засах: ${texts.details.title}` }));
    await user.selectOptions(within(card).getByLabelText(texts.details.education), 'BACHELOR');
    await user.selectOptions(within(card).getByLabelText(texts.details.jobLevel), 'SENIOR');
    await user.type(within(card).getByLabelText(texts.details.district), 'Мөрөн');

    await user.click(within(card).getByRole('button', { name: texts.details.addChild }));
    await user.click(within(card).getByRole('button', { name: mn.common.save }));
    expect(await within(card).findByText(texts.details.childDateMissing)).toBeInTheDocument();

    const child = within(card).getByRole('group', { name: 'Хүүхэд 1' });
    await user.type(within(child).getByLabelText(texts.details.childName), 'Тэмүүлэн');
    await user.type(within(child).getByLabelText(texts.details.childBirthDate), '2020-05-01');
    await user.tab();
    await user.click(within(card).getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/details')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/details')[0])).toEqual({
      birthDate: null,
      gender: null,
      education: 'BACHELOR',
      maritalStatus: null,
      district: 'Мөрөн',
      jobLevel: 'SENIOR',
      children: [{ name: 'Тэмүүлэн', gender: null, birthDate: '2020-05-01' }],
    });

    await user.click(screen.getByRole('button', { name: mn.hr.staff.dialog.leave }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(texts.details.leftKind), 'RETIRED');
    await user.click(within(dialog).getByRole('button', { name: mn.hr.staff.left.confirm }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/left')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/left')[0])).toMatchObject({
      reason: null,
      reasonKind: 'RETIRED',
    });
  });
});
