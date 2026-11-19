import {
  ErkhetPageError,
  joinJournalPages,
  readAccountOptions,
  readAmount,
  readJournalPage,
  readUpdateUrl,
} from './erkhet.journal';

// Synthetic rows only: no name, number or amount here comes from Erkhet.

const header = (trId: number, ptrId: number) => ({ ptr__id: ptrId, tr_id: trId, is_ptr: true });
const line = (over: Record<string, unknown> = {}) => ({
  description: 'Туршилтын борлуулалт',
  debit_text: '22,432.11',
  credit_text: '0.00',
  account__name: 'Туршилтын авлага',
  full_code: '120101',
  date: '2026-10-05',
  bill_number: 'T-001',
  customer: '90001 - Туршилт дэлгүүр',
  department: '',
  tr__user: 'tester',
  ptr__id: 700,
  ...over,
});
const page = (items: unknown[]) =>
  `<html><body><script>var other = [1];\n  var items = ${JSON.stringify(items)};\n</script></body></html>`;

describe('readAmount', () => {
  it('reads thousands separators and pads to two decimals', () => {
    expect(readAmount('22,432.11')).toBe('22432.11');
    expect(readAmount('1,000,000')).toBe('1000000.00');
    expect(readAmount('0.5')).toBe('0.50');
    expect(readAmount('')).toBe('0.00');
    expect(readAmount('0.00')).toBe('0.00');
  });

  it('refuses what is not an amount', () => {
    expect(() => readAmount('12.345')).toThrow(ErkhetPageError);
    expect(() => readAmount('abc')).toThrow(ErkhetPageError);
  });
});

describe('readJournalPage, the script form', () => {
  it('reads lines under their transaction header', () => {
    const lines = readJournalPage(
      page([
        header(5001, 700),
        line(),
        header(5002, 701),
        line({ debit_text: '0.00', credit_text: '1,500.00', bill_number: '', date: '2026-10-06' }),
      ]),
    );
    expect(lines).toEqual([
      {
        trId: 5001,
        ptrId: 700,
        date: '2026-10-05',
        accountCode: '120101',
        debit: '22432.11',
        credit: '0.00',
        description: 'Туршилтын борлуулалт',
        billNumber: 'T-001',
        customer: '90001 - Туршилт дэлгүүр',
      },
      expect.objectContaining({ trId: 5002, ptrId: 701, debit: '0.00', credit: '1500.00' }),
    ]);
  });

  it('keeps several lines of one transaction in order', () => {
    const lines = readJournalPage(
      page([
        header(5003, 702),
        line({ customer: '90001 - Нэг', debit_text: '100.00' }),
        line({ customer: '90002 - Хоёр', debit_text: '200.00' }),
        line({ customer: '90001 - Нэг', debit_text: '300.00' }),
      ]),
    );
    expect(lines.map((one) => [one.trId, one.customer, one.debit])).toEqual([
      [5003, '90001 - Нэг', '100.00'],
      [5003, '90002 - Хоёр', '200.00'],
      [5003, '90001 - Нэг', '300.00'],
    ]);
  });

  it('reads an empty page past the end as no lines', () => {
    expect(readJournalPage(page([]))).toEqual([]);
  });

  it('reads a text holding brackets and quotes', () => {
    const lines = readJournalPage(
      page([header(5004, 703), line({ description: 'Буцаалт ]; [тест] "ишлэл" \\ </script' })]),
    );
    expect(lines[0]?.description).toBe('Буцаалт ]; [тест] "ишлэл" \\ </script');
  });

  it('moves a negative amount to the other side', () => {
    const [one] = readJournalPage(
      page([header(5005, 704), line({ debit_text: '-50.00', credit_text: '0.00' })]),
    );
    expect(one).toMatchObject({ debit: '0.00', credit: '50.00' });
  });

  it('refuses a broken script, a page without rows and a line without a date', () => {
    expect(() => readJournalPage('<script>var items = [{"a": ];</script>')).toThrow(
      ErkhetPageError,
    );
    expect(() => readJournalPage('<html><body>Нэвтрэх</body></html>')).toThrow(ErkhetPageError);
    expect(() => readJournalPage(page([header(1, 1), line({ date: '05.10.2026' })]))).toThrow(
      ErkhetPageError,
    );
  });
});

describe('joinJournalPages', () => {
  it('joins the lines a page begins with to the transaction the page before ended with', () => {
    const first = readJournalPage(page([header(5001, 700), line({ debit_text: '1.00' })]));
    const second = readJournalPage(
      page([line({ debit_text: '2.00' }), header(5002, 701), line({ ptr__id: 701 })]),
    );
    expect(second[0]).toMatchObject({ trId: 0, ptrId: 700 });
    expect(joinJournalPages([first, second]).map((one) => [one.trId, one.debit])).toEqual([
      [5001, '1.00'],
      [5001, '2.00'],
      [5002, '22432.11'],
    ]);
  });

  it('refuses such a line on the first page, or after another transaction number', () => {
    const headless = readJournalPage(page([line()]));
    expect(() => joinJournalPages([headless])).toThrow(ErkhetPageError);
    const other = readJournalPage(page([header(5009, 999), line({ ptr__id: 999 })]));
    expect(() => joinJournalPages([other, headless])).toThrow(ErkhetPageError);
  });
});

describe('readJournalPage, the table form', () => {
  const table = (rows: string) => `<html><body><table>
    <thead><tr><th>Огноо</th><th>Баримтын дугаар</th><th>Гүйлгээний утга</th><th>Код</th>
      <th>Харилцагч</th><th>Дебит</th><th>Кредит</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;

  it('reads the rows under each transaction row', () => {
    const lines = readJournalPage(
      table(`
        <tr class="ptr bold pointer" tr_id="6001"><td colspan="7">Ажил гүйлгээний дугаар : 800</td></tr>
        <tr><td>2026-10-07</td><td>T-9</td><td>Туршилт &amp; тест</td><td>310101</td>
            <td>80001 - Туршилт нийлүүлэгч</td><td class="r">0.00</td><td class="r">1,250,000.50</td></tr>
        <tr><td>2026-10-07</td><td></td><td>Хоёр дахь</td><td>310101</td>
            <td>80002 - Өөр нийлүүлэгч</td><td>10.00</td><td>0.00</td></tr>`),
    );
    expect(lines).toEqual([
      {
        trId: 6001,
        ptrId: 800,
        date: '2026-10-07',
        accountCode: '310101',
        debit: '0.00',
        credit: '1250000.50',
        description: 'Туршилт & тест',
        billNumber: 'T-9',
        customer: '80001 - Туршилт нийлүүлэгч',
      },
      expect.objectContaining({ trId: 6001, customer: '80002 - Өөр нийлүүлэгч', debit: '10.00' }),
    ]);
  });

  it('reads a table without rows as no lines', () => {
    expect(readJournalPage(table(''))).toEqual([]);
  });
});

describe('readAccountOptions', () => {
  it('maps account codes to Erkhet ids', () => {
    const ids = readAccountOptions(
      `<form><select name="account"><option value="">---</option>
        <option value="9">120101 - Туршилтын авлага</option>
        <option value="92" selected>310101 - Туршилтын өглөг</option></select></form>`,
    );
    expect(ids.get('120101')).toBe('9');
    expect(ids.get('310101')).toBe('92');
    expect(ids.size).toBe(2);
  });

  it('refuses a form without the list', () => {
    expect(() => readAccountOptions('<form></form>')).toThrow(ErkhetPageError);
  });
});

describe('readUpdateUrl', () => {
  const answer = {
    status: 'ok',
    update_url: '/1234567890/inventory/sale/update/11/?record_id=22',
    delete_url: '/1234567890/inventory/sale/delete/11/',
  };

  it('takes the update address of the company only', () => {
    expect(readUpdateUrl(answer, '1234567890')).toBe(
      '/1234567890/inventory/sale/update/11/?record_id=22',
    );
    expect(readUpdateUrl(answer, '999999')).toBeNull();
    expect(readUpdateUrl({ status: 'ok' }, '1234567890')).toBeNull();
    expect(readUpdateUrl(null, '1234567890')).toBeNull();
  });

  it('never returns a delete address', () => {
    expect(
      readUpdateUrl({ update_url: '/1234567890/inventory/sale/delete/11/' }, '1234567890'),
    ).toBeNull();
    expect(
      readUpdateUrl({ update_url: 'https://elsewhere.test/1234567890/x' }, '1234567890'),
    ).toBeNull();
  });
});
