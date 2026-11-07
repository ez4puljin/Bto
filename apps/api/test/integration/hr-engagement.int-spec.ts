import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface PollJson {
  id: number;
  open: boolean;
  answered: boolean;
  resultsShown: boolean;
  respondents: number;
  questions: {
    id: number;
    options: { id: number; count: number; voters: string[] }[];
    texts: string[];
    average: string | null;
  }[];
}

/**
 * The staff's own side (ADR-0146): notices to everybody or to some, votes and surveys, the mood
 * that shows only counts, feedback with or without a name, thanks, a sent location, the calendar
 * with birthdays, an employee's own details and the dashboard's figures. Synthetic data.
 */
describe('hr engagement', () => {
  let app: NestExpressApplication;
  let hr: string;
  let staffA: { id: number; token: string };
  let staffB: { id: number; token: string };
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  beforeAll(async () => {
    app = await createHttpApp();
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    const a = await seedUser(app);
    const b = await seedUser(app);
    staffA = { id: a.id, token: (await login(app, a)).accessToken };
    staffB = { id: b.id, token: (await login(app, b)).accessToken };
  });
  afterAll(async () => {
    await app.close();
  });

  it('delivers a notice to its people, counts who read it, hides a withdrawn one', async () => {
    const all = await http()
      .post('/api/v1/hr/messages')
      .set(bearer(hr))
      .set(idempotency())
      .send({ kind: 'NOTICE', title: 'Бүгдэд', body: 'Хурал 15 цагт' })
      .expect(201);
    const some = await http()
      .post('/api/v1/hr/messages')
      .set(bearer(hr))
      .set(idempotency())
      .send({ kind: 'NEWS', title: 'Зөвхөн А', body: 'Текст', userIds: [staffA.id] })
      .expect(201);
    const later = await http()
      .post('/api/v1/hr/messages')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        kind: 'NOTICE',
        title: 'Маргааш',
        body: 'Текст',
        publishAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    await http()
      .post('/api/v1/hr/messages')
      .set(bearer(staffA.token))
      .set(idempotency())
      .send({ kind: 'NOTICE', title: 'x', body: 'y' })
      .expect(403);

    const idsFor = async (token: string) =>
      (
        (await http().get('/api/v1/hr/me/messages').set(bearer(token)).expect(200)).body as {
          id: number;
        }[]
      ).map((row) => row.id);
    const allId = (all.body as { id: number }).id;
    const someId = (some.body as { id: number }).id;
    const laterId = (later.body as { id: number }).id;
    expect(await idsFor(staffA.token)).toEqual(expect.arrayContaining([allId, someId]));
    expect(await idsFor(staffB.token)).toContain(allId);
    expect(await idsFor(staffB.token)).not.toContain(someId);
    expect(await idsFor(staffA.token)).not.toContain(laterId);

    const feed = (await http().get('/api/v1/hr/me/feed').set(bearer(staffB.token)).expect(200))
      .body as { unreadNotices: number; popups: { id: number }[] };
    expect(feed.popups.map((row) => row.id)).toContain(allId);
    await http()
      .post('/api/v1/hr/me/messages/read')
      .set(bearer(staffB.token))
      .send({ ids: [allId, someId] })
      .expect(204);
    const list = (await http().get('/api/v1/hr/messages').set(bearer(hr)).expect(200)).body as {
      id: number;
      reads: number;
      recipients: number;
    }[];
    expect(list.find((row) => row.id === allId)?.reads).toBe(1);
    // Someone it was not for cannot mark it read.
    expect(list.find((row) => row.id === someId)).toMatchObject({ reads: 0, recipients: 1 });

    await http().post(`/api/v1/hr/messages/${allId}/withdraw`).set(bearer(hr)).expect(200);
    expect(await idsFor(staffB.token)).not.toContain(allId);
  });

  it('takes one answer to a vote, shows results only as set, and refuses a closed one', async () => {
    const created = await http()
      .post('/api/v1/hr/polls')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        kind: 'VOTE',
        title: 'Зугаалга хаашаа?',
        showResults: true,
        questions: [{ text: 'Хаашаа?', kind: 'SINGLE', options: ['Хөвсгөл', 'Хархорин'] }],
      })
      .expect(201);
    const poll = created.body as PollJson;
    const question = poll.questions[0];
    const [first, second] = question?.options ?? [];
    if (!question || !first || !second) throw new Error('poll shape');

    // A vote holds one question; an option list needs two.
    await http()
      .post('/api/v1/hr/polls')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        kind: 'VOTE',
        title: 'Буруу',
        questions: [
          { text: 'a', kind: 'SINGLE', options: ['1', '2'] },
          { text: 'b', kind: 'SINGLE', options: ['1', '2'] },
        ],
      })
      .expect(422);

    const before = (await http().get('/api/v1/hr/me/polls').set(bearer(staffA.token)).expect(200))
      .body as PollJson[];
    expect(before.find((row) => row.id === poll.id)).toMatchObject({
      answered: false,
      resultsShown: false,
    });
    const answer = (optionId: number) => ({
      answers: [{ questionId: question.id, optionIds: [optionId] }],
    });
    // Two options on a single-choice question, an option of nothing: refused.
    await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffA.token))
      .send({ answers: [{ questionId: question.id, optionIds: [first.id, second.id] }] })
      .expect(422);
    await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffA.token))
      .send({ answers: [] })
      .expect(422);
    const voted = await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffA.token))
      .send(answer(first.id))
      .expect(200);
    expect(voted.body).toMatchObject({ answered: true, resultsShown: true, respondents: 1 });
    await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffA.token))
      .send(answer(second.id))
      .expect(409);

    const forHr = (await http().get('/api/v1/hr/polls').set(bearer(hr)).expect(200))
      .body as PollJson[];
    const counted = forHr.find((row) => row.id === poll.id)?.questions[0]?.options[0];
    expect(counted?.count).toBe(1);
    expect(counted?.voters).toHaveLength(1);

    await http().post(`/api/v1/hr/polls/${poll.id}/close`).set(bearer(hr)).expect(200);
    await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffB.token))
      .send(answer(first.id))
      .expect(409);
  });

  it('keeps a survey anonymous and lets an answer change when allowed', async () => {
    const created = await http()
      .post('/api/v1/hr/polls')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        kind: 'SURVEY',
        title: 'Ажлын орчин',
        anonymous: true,
        allowChange: true,
        questions: [
          { text: 'Хэр сэтгэл хангалуун вэ?', kind: 'SCALE' },
          { text: 'Юу сайжруулах вэ?', kind: 'TEXT', required: false },
          { text: 'Юу таалагддаг вэ?', kind: 'MULTI', options: ['Цалин', 'Хамт олон', 'Орчин'] },
        ],
      })
      .expect(201);
    const poll = created.body as PollJson;
    const [scale, text, multi] = poll.questions;
    if (!scale || !text || !multi) throw new Error('survey shape');
    const send = (token: string, value: number, optionIds: number[], note?: string) =>
      http()
        .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
        .set(bearer(token))
        .send({
          answers: [
            { questionId: scale.id, value },
            { questionId: multi.id, optionIds },
            ...(note ? [{ questionId: text.id, text: note }] : []),
          ],
        });
    const [one, two] = multi.options;
    if (!one || !two) throw new Error('options');
    await send(staffA.token, 2, [one.id], 'Гэрэлтүүлэг').expect(200);
    await send(staffA.token, 4, [one.id, two.id]).expect(200);
    await send(staffB.token, 5, [two.id]).expect(200);
    // A required question may not be skipped.
    await http()
      .post(`/api/v1/hr/me/polls/${poll.id}/answers`)
      .set(bearer(staffB.token))
      .send({ answers: [{ questionId: scale.id, value: 3 }] })
      .expect(422);
    const result = (
      (await http().get('/api/v1/hr/polls').set(bearer(hr)).expect(200)).body as PollJson[]
    ).find((row) => row.id === poll.id);
    expect(result?.respondents).toBe(2);
    expect(result?.questions[0]?.average).toBe('4.5');
    expect(result?.questions[2]?.options[1]?.count).toBe(2);
    expect(result?.questions[2]?.options[1]?.voters).toEqual([]);
    // The note was replaced by the changed answer.
    expect(result?.questions[1]?.texts).toEqual([]);
  });

  it('shows HR only the counts of the mood', async () => {
    await http().put('/api/v1/hr/me/mood').set(bearer(staffA.token)).send({ score: 5 }).expect(200);
    await http().put('/api/v1/hr/me/mood').set(bearer(staffA.token)).send({ score: 4 }).expect(200);
    await http().put('/api/v1/hr/me/mood').set(bearer(staffB.token)).send({ score: 9 }).expect(422);
    const moods = (
      await http()
        .get('/api/v1/hr/moods')
        .query({ from: today, to: today })
        .set(bearer(hr))
        .expect(200)
    ).body as { scores: { score: number; count: number }[]; total: number };
    expect(moods.scores.find((row) => row.score === 4)?.count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(moods)).not.toContain('userId');
    await http()
      .get('/api/v1/hr/moods')
      .query({ from: today, to: today })
      .set(bearer(staffA.token))
      .expect(403);
  });

  it('takes feedback under a name or without one, and HR answers', async () => {
    const named = await http()
      .post('/api/v1/hr/me/feedback')
      .set(bearer(staffA.token))
      .set(idempotency())
      .send({ category: 'SUGGESTION', title: 'Цайны газар', body: 'Нэмье' })
      .expect(201);
    const hidden = await http()
      .post('/api/v1/hr/me/feedback')
      .set(bearer(staffB.token))
      .set(idempotency())
      .send({ category: 'COMPLAINT', title: 'Нэргүй', body: 'Текст', anonymous: true })
      .expect(201);
    expect(hidden.body).toMatchObject({ userId: null, fullName: null, status: 'NEW' });
    const namedId = (named.body as { id: number }).id;
    await http()
      .put(`/api/v1/hr/feedback/${namedId}`)
      .set(bearer(staffA.token))
      .send({ status: 'DONE' })
      .expect(403);
    await http()
      .put(`/api/v1/hr/feedback/${namedId}`)
      .set(bearer(hr))
      .send({ status: 'DONE', reply: 'Шийдлээ' })
      .expect(200);
    const mine = (await http().get('/api/v1/hr/me/feedback').set(bearer(staffA.token)).expect(200))
      .body as { id: number; reply: string | null }[];
    expect(mine.find((row) => row.id === namedId)?.reply).toBe('Шийдлээ');
    const theirs = (
      await http().get('/api/v1/hr/me/feedback').set(bearer(staffB.token)).expect(200)
    ).body as unknown[];
    expect(theirs).toHaveLength(0);
  });

  it('ranks thanks and refuses thanking oneself; keeps a sent location', async () => {
    await http()
      .post('/api/v1/hr/thanks')
      .set(bearer(staffA.token))
      .set(idempotency())
      .send({ toUserId: staffB.id, note: 'Тусалсанд баярлалаа' })
      .expect(201);
    await http()
      .post('/api/v1/hr/thanks')
      .set(bearer(staffA.token))
      .set(idempotency())
      .send({ toUserId: staffA.id, note: 'Өөртөө' })
      .expect(422);
    const thanks = (
      await http()
        .get('/api/v1/hr/thanks')
        .query({ from: today, to: today })
        .set(bearer(staffA.token))
        .expect(200)
    ).body as { ranking: { userId: number; count: number }[] };
    expect(thanks.ranking.find((row) => row.userId === staffB.id)?.count).toBe(1);

    await http()
      .post('/api/v1/hr/me/locations')
      .set(bearer(staffA.token))
      .set(idempotency())
      .send({ lat: '49.634500', lng: '100.162300', accuracyM: 12, note: 'Томилолт' })
      .expect(201);
    const shares = (
      await http()
        .get('/api/v1/hr/location-shares')
        .query({ from: today, to: today, userId: staffA.id })
        .set(bearer(hr))
        .expect(200)
    ).body as { lat: string; note: string }[];
    expect(shares[0]).toMatchObject({ lat: '49.6345', note: 'Томилолт' });
    await http()
      .get('/api/v1/hr/location-shares')
      .query({ from: today, to: today })
      .set(bearer(staffA.token))
      .expect(403);
  });

  it('lets an employee keep their details and puts birthdays on everybody’s calendar', async () => {
    const birthDate = `1990-${today.slice(5, 7)}-15`;
    const childBirth = addDays(today, -800);
    const saved = await http()
      .put('/api/v1/hr/me/profile')
      .set(bearer(staffA.token))
      .send({
        birthDate,
        gender: 'FEMALE',
        education: 'BACHELOR',
        maritalStatus: 'MARRIED',
        district: 'Мөрөн',
        children: [{ name: 'Хүү', gender: 'MALE', birthDate: childBirth }],
      })
      .expect(200);
    expect(saved.body).toMatchObject({ birthDate, education: 'BACHELOR', district: 'Мөрөн' });
    await http()
      .put('/api/v1/hr/me/profile')
      .set(bearer(staffA.token))
      .send({ birthDate: addDays(today, 1), children: [] })
      .expect(422);

    const month = today.slice(0, 7);
    await http()
      .post('/api/v1/hr/events')
      .set(bearer(staffB.token))
      .send({ typeId: 1, title: 'x', fromDate: today })
      .expect(403);
    // The migration's own rows do not outlive the harness's reset: the suite makes its type.
    const meeting = (
      await http()
        .post('/api/v1/hr/event-types')
        .set(bearer(hr))
        .send({ name: 'Хурал', color: '#7c3aed' })
        .expect(201)
    ).body as { id: number };
    await http()
      .post('/api/v1/hr/events')
      .set(bearer(hr))
      .send({ typeId: meeting.id, title: 'Нийт хурал', fromDate: today, toDate: today })
      .expect(201);
    const calendar = (
      await http().get('/api/v1/hr/calendar').query({ month }).set(bearer(staffB.token)).expect(200)
    ).body as { date: string; kind: string; title: string; userId: number | null }[];
    const birthday = calendar.find((row) => row.kind === 'BIRTHDAY' && row.userId === staffA.id);
    expect(birthday?.date).toBe(`${month}-15`);
    // The day only: no year of birth reaches a colleague.
    expect(JSON.stringify(birthday)).not.toContain('1990');
    expect(calendar.some((row) => row.title === 'Нийт хурал')).toBe(true);
  });

  it('keeps the calendar’s types as HR’s own list (ADR-0171)', async () => {
    const month = today.slice(0, 7);
    const typeBody = { name: 'Бараа буух', color: '#f97316' };
    await http()
      .post('/api/v1/hr/event-types')
      .set(bearer(staffB.token))
      .send(typeBody)
      .expect(403);
    const created = (
      await http().post('/api/v1/hr/event-types').set(bearer(hr)).send(typeBody).expect(201)
    ).body as { id: number; name: string; events: number; archivedAt: string | null };
    expect(created).toMatchObject({ name: 'Бараа буух', events: 0, archivedAt: null });

    // The same name in other letters' case is the same type.
    const twin = await http()
      .post('/api/v1/hr/event-types')
      .set(bearer(hr))
      .send({ name: 'БАРАА БУУХ', color: '#000000' });
    expect(twin.status).toBe(409);
    expect((twin.body as { code: string }).code).toBe('DUPLICATE_VALUE');
    await http()
      .post('/api/v1/hr/event-types')
      .set(bearer(hr))
      .send({ name: 'Өнгөгүй', color: 'red' })
      .expect(422);

    const event = (
      await http()
        .post('/api/v1/hr/events')
        .set(bearer(hr))
        .send({ typeId: created.id, title: 'Ачаа', fromDate: today, toDate: today })
        .expect(201)
    ).body as { eventId: number };
    const items = async () =>
      (await http().get('/api/v1/hr/calendar').query({ month }).set(bearer(hr)).expect(200))
        .body as {
        eventId: number | null;
        kind: string;
        typeId: number | null;
        typeName: string | null;
        typeColor: string | null;
      }[];
    // An installed staff app knows only the fixed kinds: a new type reaches it as an EVENT.
    expect((await items()).find((row) => row.eventId === event.eventId)).toMatchObject({
      kind: 'EVENT',
      typeId: created.id,
      typeName: 'Бараа буух',
      typeColor: '#f97316',
    });

    await http()
      .put(`/api/v1/hr/event-types/${created.id}`)
      .set(bearer(hr))
      .send({ name: 'Бараа ирэх', color: '#ea580c' })
      .expect(200);
    await http()
      .put(`/api/v1/hr/event-types/${created.id}/archived`)
      .set(bearer(staffB.token))
      .send({ archived: true })
      .expect(403);
    await http()
      .put(`/api/v1/hr/event-types/${created.id}/archived`)
      .set(bearer(hr))
      .send({ archived: true })
      .expect(200);

    // Archived: out of the list, closed to new events, still on the event that holds it.
    const active = (await http().get('/api/v1/hr/event-types').set(bearer(hr)).expect(200))
      .body as { id: number }[];
    expect(active.some((type) => type.id === created.id)).toBe(false);
    const all = (
      await http()
        .get('/api/v1/hr/event-types')
        .query({ includeArchived: 'true' })
        .set(bearer(hr))
        .expect(200)
    ).body as { id: number; events: number }[];
    expect(all.find((type) => type.id === created.id)?.events).toBe(1);
    await http()
      .post('/api/v1/hr/events')
      .set(bearer(hr))
      .send({ typeId: created.id, title: 'Шинэ', fromDate: today, toDate: today })
      .expect(422);
    expect((await items()).find((row) => row.eventId === event.eventId)?.typeName).toBe(
      'Бараа ирэх',
    );
    await http()
      .put(`/api/v1/hr/events/${event.eventId}`)
      .set(bearer(hr))
      .send({ typeId: created.id, title: 'Ачаа ирэв', fromDate: today, toDate: today })
      .expect(200);
    await http()
      .post('/api/v1/hr/events')
      .set(bearer(hr))
      .send({ typeId: 999999, title: 'Алга', fromDate: today, toDate: today })
      .expect(422);

    await http()
      .put(`/api/v1/hr/event-types/${created.id}/archived`)
      .set(bearer(hr))
      .send({ archived: false })
      .expect(200);
    await http()
      .post('/api/v1/hr/events')
      .set(bearer(hr))
      .send({ typeId: created.id, title: 'Дахин', fromDate: today, toDate: today })
      .expect(201);
  });

  it('lets whoever does the work mark an event done, and keeps who and when (ADR-0171 #8)', async () => {
    const month = today.slice(0, 7);
    const type = (
      await http()
        .post('/api/v1/hr/event-types')
        .set(bearer(hr))
        .send({ name: 'Тооллого', color: '#8b5cf6' })
        .expect(201)
    ).body as { id: number };
    const event = (
      await http()
        .post('/api/v1/hr/events')
        .set(bearer(hr))
        .send({ typeId: type.id, title: 'Заал тоолно', fromDate: today, toDate: today })
        .expect(201)
    ).body as { eventId: number; doneAt: string | null };
    expect(event.doneAt).toBeNull();

    const done = async (token: string, value: boolean) =>
      (
        await http()
          .put(`/api/v1/hr/events/${event.eventId}/done`)
          .set(bearer(token))
          .send({ done: value })
          .expect(200)
      ).body as { doneAt: string | null; doneByName: string | null };
    await http().put(`/api/v1/hr/events/${event.eventId}/done`).send({ done: true }).expect(401);

    const first = await done(staffA.token, true);
    expect(first.doneAt).not.toBeNull();
    expect(first.doneByName).toBe('Тест хэрэглэгч');
    // Asked again by someone else: the first mark stands, who and when with it.
    const again = await done(staffB.token, true);
    expect(again.doneAt).toBe(first.doneAt);
    expect(again.doneByName).toBe(first.doneByName);

    const shown = (
      await http().get('/api/v1/hr/calendar').query({ month }).set(bearer(hr)).expect(200)
    ).body as { eventId: number | null; doneAt: string | null }[];
    expect(shown.find((row) => row.eventId === event.eventId)?.doneAt).toBe(first.doneAt);

    // Editing the event does not touch the mark.
    const edited = (
      await http()
        .put(`/api/v1/hr/events/${event.eventId}`)
        .set(bearer(hr))
        .send({ typeId: type.id, title: 'Заал тоолов', fromDate: today, toDate: today })
        .expect(200)
    ).body as { doneAt: string | null };
    expect(edited.doneAt).toBe(first.doneAt);

    expect(await done(staffB.token, false)).toMatchObject({ doneAt: null, doneByName: null });

    // One audit row for each real change: the second tick above changed nothing and wrote none.
    const sql = await connectAs('app');
    const audit = await sql.query<{ after: { done?: boolean } }>(
      `SELECT after FROM audit_log WHERE entity = 'hr_event' AND entity_id = $1 ORDER BY id`,
      [String(event.eventId)],
    );
    await sql.end();
    expect(audit.rows.map((row) => row.after.done).filter((value) => value !== undefined)).toEqual([
      true,
      false,
    ]);

    await http().delete(`/api/v1/hr/events/${event.eventId}`).set(bearer(hr)).expect(204);
    await http()
      .put(`/api/v1/hr/events/${event.eventId}/done`)
      .set(bearer(staffA.token))
      .send({ done: true })
      .expect(404);
  });

  it('works out the dashboard’s figures, for HR only', async () => {
    const from = `${today.slice(0, 7)}-01`;
    const people = (
      await http()
        .get('/api/v1/hr/insights/workforce')
        .query({ from, to: today })
        .set(bearer(hr))
        .expect(200)
    ).body as {
      total: number;
      genders: { key: string; count: number }[];
      children: { key: string; male: number }[];
      childrenTotal: number;
      movement: unknown[];
    };
    expect(people.total).toBeGreaterThan(0);
    expect(people.genders.find((row) => row.key === 'FEMALE')?.count).toBeGreaterThanOrEqual(1);
    expect(people.children.find((row) => row.key === '0-2')?.male).toBeGreaterThanOrEqual(1);
    expect(people.movement).toHaveLength(12);

    await http()
      .get('/api/v1/hr/insights/attendance')
      .query({ from, to: today })
      .set(bearer(hr))
      .expect(200);
    const requests = (
      await http()
        .get('/api/v1/hr/insights/requests')
        .query({ year: Number.parseInt(today.slice(0, 4), 10) })
        .set(bearer(hr))
        .expect(200)
    ).body as { months: unknown[] };
    expect(requests.months).toHaveLength(12);
    await http()
      .get('/api/v1/hr/insights/workforce')
      .query({ from, to: today })
      .set(bearer(staffA.token))
      .expect(403);
  });
});
