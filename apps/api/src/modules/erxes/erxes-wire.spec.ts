import { ErxesClient, ErxesError, type ErxesFetch } from './erxes.client';
import {
  attachmentUrl,
  DEAL_DETAIL,
  dealUrl,
  fieldLabelsOf,
  isBlockedBoard,
  type QueryShape,
  readDeal,
  renderQuery,
  withoutField,
} from './erxes-wire';
import { FIXTURE_DEAL, FIXTURE_FIELDS, FIXTURE_PRODUCTS } from './erxes-wire.fixture';

describe('reading a deal', () => {
  const deal = readDeal(FIXTURE_DEAL, FIXTURE_PRODUCTS);

  it('reads everything the owner listed', () => {
    expect(deal).toMatchObject({
      erxesId: 'd-1001',
      name: 'Нэг дэлгүүр 11/17',
      number: 'MB-1001',
      description: 'Өглөө 10 цагаас өмнө хүргэнэ.\nХаалга нь арын талд.',
      pipelineId: 'pl-murun',
      pipelineName: 'Мөрөн Борлуулалт',
      stageName: 'Шинэ',
      creatorId: 'u-seller',
      creator: { email: 'seller@example.test', fullName: 'Туяа Бат' },
      labels: [{ name: 'Яаралтай', color: '#ff0000' }],
      customFields: [
        { fieldId: 'f-route', value: 'Мөрөн төв' },
        { fieldId: 'f-paid', value: 'true' },
      ],
      attachments: [{ name: 'zahialga.jpg', url: 'uploads/zahialga.jpg' }],
    });
    expect(deal?.createdAt?.toISOString()).toBe('2026-11-17T02:10:00.000Z');
    expect(deal?.assigned.map((user) => user.fullName)).toEqual(['Болд Дорж']);
  });

  it('puts companies before people and keeps their codes and phones', () => {
    expect(deal?.parties).toEqual([
      {
        kind: 'COMPANY',
        erxesId: 'co-shop',
        code: '50001',
        name: 'Нэг дэлгүүр',
        regNo: null,
        phones: ['88001122'],
      },
      {
        kind: 'CUSTOMER',
        erxesId: 'c-person',
        code: null,
        name: 'Ган Сараа',
        regNo: null,
        phones: ['99112233'],
      },
    ]);
  });

  it('gives each line its product code, unit and erxes prices as written', () => {
    expect(deal?.lines).toEqual([
      {
        erxesProductId: 'p-cola',
        code: '101001',
        name: 'Кола 0.5л',
        barcodes: ['4006381333931'],
        uom: 'ш',
        productUom: 'ш',
        quantity: '24',
        unitPrice: '1500',
        discount: '3600',
        discountPercent: '10',
        tax: '0',
        amount: '32400',
      },
      expect.objectContaining({ erxesProductId: 'p-old', code: '900123', quantity: '5' }),
    ]);
  });

  it('lives without anything but the id', () => {
    expect(readDeal({ _id: 'd-2' })).toMatchObject({
      erxesId: 'd-2',
      name: null,
      creator: null,
      parties: [],
      lines: [],
    });
    expect(readDeal({ name: 'no id' })).toBeNull();
    expect(readDeal('text')).toBeNull();
  });

  it('reads a line whose product comes inside it and a date in milliseconds', () => {
    const read = readDeal({
      _id: 'd-3',
      createdAt: 1794967800000,
      products: [{ productId: 'p-9', quantity: '2.5', product: { _id: 'p-9', code: '777' } }],
    });
    expect(read?.lines[0]).toMatchObject({ erxesProductId: 'p-9', code: '777', quantity: '2.5' });
    expect(read?.createdAt?.getTime()).toBe(1794967800000);
  });

  it('names fields, links and the board that is never copied', () => {
    expect(fieldLabelsOf(FIXTURE_FIELDS)).toEqual({
      'f-route': 'Чиглэл',
      'f-paid': 'Төлбөр төлсөн',
    });
    expect(deal && dealUrl('https://erxes.example.test', deal)).toBe(
      'https://erxes.example.test/deal/board?id=b-khuvsgul&pipelineId=pl-murun&itemId=d-1001',
    );
    expect(attachmentUrl('https://erxes.example.test', 'uploads/a b.jpg')).toBe(
      'https://erxes.example.test/gateway/read-file?key=uploads%2Fa%20b.jpg',
    );
    expect(attachmentUrl('https://erxes.example.test', 'https://cdn.example.test/a.jpg')).toBe(
      'https://cdn.example.test/a.jpg',
    );
    expect(isBlockedBoard('Хархорин')).toBe(true);
    expect(isBlockedBoard('Хөвсгөл')).toBe(false);
  });
});

describe('a query as a tree', () => {
  const shape: QueryShape = {
    root: 'dealDetail',
    declare: '$id: String!',
    args: '_id: $id',
    selection: { _id: true, stage: { _id: true, name: true }, labels: { name: true } },
  };

  it('is written one field a line, each line knowing its field', () => {
    const { document, paths } = renderQuery(shape);
    expect(document.split('\n')).toEqual([
      'query bto($id: String!) {',
      'dealDetail(_id: $id) {',
      '_id',
      'stage {',
      '_id',
      'name',
      '}',
      'labels {',
      'name',
      '}',
      '}',
      '}',
    ]);
    expect(paths[5]).toEqual(['stage', 'name']);
    expect(paths[6]).toBeNull();
  });

  it('loses one field, and a parent with its last field', () => {
    expect(withoutField(shape.selection, ['stage', 'name'])).toEqual({
      _id: true,
      stage: { _id: true },
      labels: { name: true },
    });
    expect(withoutField(shape.selection, ['labels', 'name'])).toEqual({
      _id: true,
      stage: { _id: true, name: true },
    });
    expect(withoutField({ _id: true }, ['_id'])).toBeNull();
  });

  it('only ever sends queries besides the sign-in', () => {
    expect(renderQuery(DEAL_DETAIL[0] as QueryShape).document.startsWith('query ')).toBe(true);
  });
});

describe('the erxes client', () => {
  /** Not a real sign-in: the «erxes» below is scripted. */
  const account = {
    baseUrl: 'https://erxes.example.test',
    email: 'bto@example.test',
    password: 'not-a-real-password',
  };
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { ...init, headers: { ...init.headers } });

  function scripted(options: { unknown?: string[]; expireOnce?: boolean } = {}) {
    const calls: { document: string; cookie: string | undefined }[] = [];
    let expired = options.expireOnce ?? false;
    let session = 0;
    const fetchFn: ErxesFetch = (url, init) => {
      const { query, variables } = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
        query: string;
        variables: Record<string, string>;
      };
      const cookie = (init.headers as Record<string, string>).cookie;
      calls.push({ document: query, cookie });
      expect(url).toBe('https://erxes.example.test/gateway/graphql');
      if (query.startsWith('mutation login')) {
        if (variables.password !== account.password) {
          return Promise.resolve(json({ errors: [{ message: 'Invalid login' }] }));
        }
        session += 1;
        return Promise.resolve(
          json(
            { data: { login: 'loggedIn' } },
            { headers: { 'set-cookie': `auth-token=tok${session}; Path=/; HttpOnly` } },
          ),
        );
      }
      if (!cookie?.startsWith('auth-token=tok')) {
        return Promise.resolve(json({ errors: [{ message: 'Login required' }] }));
      }
      if (expired) {
        expired = false;
        return Promise.resolve(json({ errors: [{ message: 'Login required' }] }));
      }
      const lines = query.split('\n');
      const errors = lines.flatMap((line, index) =>
        (options.unknown ?? []).includes(line.replace(' {', ''))
          ? [
              {
                message: `Cannot query field "${line.replace(' {', '')}" on type "Deal".`,
                locations: [{ line: index + 1, column: 1 }],
              },
            ]
          : [],
      );
      if (errors.length > 0) return Promise.resolve(json({ errors }, { status: 400 }));
      return Promise.resolve(json({ data: { dealDetail: { _id: 'd-1' } } }));
    };
    return { fetchFn, calls };
  }

  it('signs in once, keeps the session and sends it as the cookie', async () => {
    const { fetchFn, calls } = scripted();
    const client = new ErxesClient(account, fetchFn);
    await expect(client.read(DEAL_DETAIL, { id: 'd-1' })).resolves.toEqual({ _id: 'd-1' });
    await client.read(DEAL_DETAIL, { id: 'd-1' });
    expect(calls.filter((call) => call.document.startsWith('mutation'))).toHaveLength(1);
    expect(calls[1]?.cookie).toBe('auth-token=tok1');
    expect(client.session).toBe('tok1');
    // The next client carries the session on without signing in.
    const next = new ErxesClient(account, fetchFn, client.session);
    await next.read(DEAL_DETAIL, { id: 'd-1' });
    expect(calls.filter((call) => call.document.startsWith('mutation'))).toHaveLength(1);
  });

  it('cuts the fields erxes refuses and asks again', async () => {
    const { fetchFn, calls } = scripted({ unknown: ['unUsedAmount', 'registrationNumber'] });
    const client = new ErxesClient(account, fetchFn);
    await expect(client.read(DEAL_DETAIL, { id: 'd-1' })).resolves.toEqual({ _id: 'd-1' });
    expect(client.cuts).toEqual([
      'dealDetail.unUsedAmount',
      'dealDetail.customers.registrationNumber',
      'dealDetail.companies.registrationNumber',
    ]);
    expect(calls[calls.length - 1]?.document).not.toContain('registrationNumber');
    expect(calls[calls.length - 1]?.document).toContain('taxNumber');
  });

  it('signs in again when the session ended, and says when the sign-in is refused', async () => {
    const { fetchFn, calls } = scripted({ expireOnce: true });
    const client = new ErxesClient(account, fetchFn);
    await client.read(DEAL_DETAIL, { id: 'd-1' });
    expect(calls.filter((call) => call.document.startsWith('mutation'))).toHaveLength(2);
    const wrong = new ErxesClient({ ...account, password: 'wrong' }, fetchFn);
    await expect(wrong.signIn()).rejects.toMatchObject({ reason: 'LOGIN_FAILED' });
    await expect(wrong.signIn()).rejects.toBeInstanceOf(ErxesError);
  });

  it('never sends the password to an address that is not https', () => {
    expect(
      () => new ErxesClient({ ...account, baseUrl: 'http://erxes.example.test' }, fetch),
    ).toThrow(ErxesError);
  });

  it('moves on to the older name of a query erxes does not know', async () => {
    const fetchFn: ErxesFetch = (_url, init) => {
      const { query } = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
        query: string;
      };
      if (query.startsWith('mutation')) {
        return Promise.resolve(
          json(
            { data: { login: 'loggedIn' } },
            { headers: { 'set-cookie': 'auth-token=t; Path=/' } },
          ),
        );
      }
      return Promise.resolve(
        query.includes('newBoards')
          ? json({
              errors: [{ message: 'Cannot query field "newBoards" on type "Query".' }],
            })
          : json({ data: { boards: [{ _id: 'b1' }] } }),
      );
    };
    const client = new ErxesClient(account, fetchFn);
    await expect(
      client.read([
        { root: 'newBoards', selection: { _id: true } },
        { root: 'boards', selection: { _id: true } },
      ]),
    ).resolves.toEqual([{ _id: 'b1' }]);
  });
});
