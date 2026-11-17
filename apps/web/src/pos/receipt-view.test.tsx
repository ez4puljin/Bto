import { render, screen, within } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import {
  defaultReceiptLayout,
  type EdgeReceipt,
  type EdgeReceiptLine,
  type ReceiptLayout,
} from '@tugeel/shared/pos';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { sampleReceipt } from '@/features/pos/receipt-sample';
import { i18n } from '@/lib/i18n';
import { ReceiptView } from './components/receipt-view';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function draw(
  layout: ReceiptLayout,
  member: boolean,
  change: (receipt: EdgeReceipt) => EdgeReceipt = (receipt) => receipt,
) {
  const receipt = change(
    sampleReceipt('SALE', { test: false, company: false, credit: false, member }, null, 'Оргил'),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <ReceiptView receipt={receipt} layout={layout} tillId={3} paper />
    </I18nextProvider>,
  );
}

describe('the receipt from its template (ADR-0141, ADR-0142)', () => {
  it('prints the free blocks on their receipts with the values filled in', () => {
    const base = defaultReceiptLayout();
    draw(
      {
        ...base,
        blocks: [
          { type: 'LOGO', image: PNG, width: 60, align: 'CENTER' },
          ...base.blocks,
          { type: 'TEXT', text: 'Дугаар {{number}}', align: 'CENTER', size: 'MD', bold: true },
          {
            type: 'TEXT',
            text: 'Гишүүнд {{member}}',
            align: 'LEFT',
            size: 'SM',
            bold: false,
            when: 'MEMBER',
          },
          { type: 'TEXT', text: 'Нуусан', align: 'LEFT', size: 'SM', bold: false, hidden: true },
          { type: 'QR', data: 'https://bto.mn', caption: 'Манай хуудас', size: 'SM' },
          { type: 'BARCODE', showNumber: true },
        ],
      },
      false,
    );
    expect(screen.getByText('Дугаар К1-261104-0042')).toBeInTheDocument();
    expect(screen.queryByText(/Гишүүнд/)).not.toBeInTheDocument();
    expect(screen.queryByText('Нуусан')).not.toBeInTheDocument();
    expect(screen.getByText('Манай хуудас')).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: mn.posKiosk.receipt.barcode.replace('{{number}}', 'К1-261104-0042'),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^9930003261104004[0-9]{2}$/)).toBeInTheDocument();
    expect(document.querySelector(`img[src="${PNG}"]`)).not.toBeNull();
  });

  it('prints a member block on a member sale', () => {
    const base = defaultReceiptLayout();
    draw(
      {
        ...base,
        blocks: [
          ...base.blocks,
          {
            type: 'TEXT',
            text: 'Гишүүнд {{member}}',
            align: 'LEFT',
            size: 'SM',
            bold: false,
            when: 'MEMBER',
          },
        ],
      },
      true,
    );
    expect(screen.getByText('Гишүүнд Сарантуяа')).toBeInTheDocument();
  });
});

describe('the bulk price on the receipt (owner 2026-11-17, ADR-0207)', () => {
  const offer = { fromQtyBase: '6.000', baseUom: 'ш', bulkPrice: '18010.00' };
  const lines: EdgeReceiptLine[] = [
    {
      name: 'Сүү 1л',
      uomName: 'ш',
      qty: '6',
      unitPrice: '18010.00',
      total: '108060.00',
      bulkOffer: { ...offer, atBulk: true },
    },
    {
      name: 'Тос 1л',
      uomName: 'ш',
      qty: '2',
      unitPrice: '19500.00',
      total: '39000.00',
      bulkOffer: { ...offer, atBulk: false },
    },
    {
      name: 'Талх',
      uomName: 'ш',
      qty: '1',
      unitPrice: '2800.00',
      total: '2800.00',
      bulkOffer: null,
    },
    // Stored before the offer was printed: no field at all.
    { name: 'Ус', uomName: 'ш', qty: '1', unitPrice: '1000.00', total: '1000.00' },
  ];
  const withLines = (receipt: EdgeReceipt): EdgeReceipt => ({ ...receipt, lines });
  const notes = () => screen.queryAllByText(/бөөний|Бөөний үнэ/);
  const numbers = () =>
    Array.from(document.querySelectorAll('[data-line-no]')).map((node) => node.textContent);
  const layoutOf = (compact: boolean): ReceiptLayout => {
    const base = defaultReceiptLayout();
    return {
      ...base,
      blocks: base.blocks.map((block) => (block.type === 'LINES' ? { ...block, compact } : block)),
    };
  };

  it('prints a header row and numbers the lines, a «*» after the bulk one', () => {
    draw(layoutOf(false), false, withLines);
    const r = mn.posKiosk.receipt;
    for (const head of [r.colNo, r.colName, r.colQty, r.colPrice, r.colTotal])
      expect(screen.getAllByText(head).length).toBeGreaterThan(0);
    expect(r.colPrice).toBe('Нэгж үнэ /НӨАТ-тай/');
    expect(r.colTotal).toBe('Дүн ₮');
    expect(numbers()).toEqual(['1*', '2', '3', '4']);
    expect(notes()).toHaveLength(0);
  });

  it('numbers the compact lines too, with no header and no bulk note', () => {
    draw(layoutOf(true), false, withLines);
    expect(screen.getByText(/^1\* Сүү 1л/)).toBeInTheDocument();
    expect(screen.getByText(/^2 Тос 1л/)).toBeInTheDocument();
    expect(screen.queryByText(mn.posKiosk.receipt.colPrice)).toBeNull();
    expect(notes()).toHaveLength(0);
  });

  it('prints no «*» on a return', () => {
    draw(defaultReceiptLayout(), false, (receipt) => ({
      ...withLines(receipt),
      lines: lines.map(({ bulkOffer: _bulk, ...line }) => line),
      kind: 'RETURN',
    }));
    expect(numbers()).toEqual(['1', '2', '3', '4']);
  });
});

describe('the N+M on the receipt (owner 2026-11-17)', () => {
  const r = mn.posKiosk.receipt;
  const valueOf = (label: string | RegExp) => screen.getByText(label).nextElementSibling;
  const layoutOf = (compact: boolean): ReceiptLayout => {
    const base = defaultReceiptLayout();
    return {
      ...base,
      blocks: base.blocks.map((block) => (block.type === 'LINES' ? { ...block, compact } : block)),
    };
  };

  it('prints the paid quantity, the free goods apart and the totals that still add up', () => {
    // The sample: milk 2 × 3,500, bread 2,800, water 13,900 (−500), soap 3 of a 2+1 at 2,000.
    draw(layoutOf(false), false);
    const [soap] = screen.getAllByText('Саван гарын');
    if (!soap) throw new Error('no soap line');
    // The goods line: 2 paid × 2,000 = 4,000.
    expect(soap.nextElementSibling).toHaveTextContent(/^2$/);
    expect(soap.nextElementSibling?.nextElementSibling).toHaveTextContent('2,000');
    expect(soap.nextElementSibling?.nextElementSibling?.nextElementSibling).toHaveTextContent(
      '4,000',
    );
    const section = screen.getByRole('region', { name: r.promotion });
    expect(within(section).getByText(r.promotion)).toBeInTheDocument();
    const free = within(section).getByText('Саван гарын');
    expect(free.nextElementSibling).toHaveTextContent(/^1$/);
    expect(free.nextElementSibling?.nextElementSibling).toHaveTextContent('2,000');
    expect(free.nextElementSibling?.nextElementSibling?.nextElementSibling).toHaveTextContent(
      '2,000',
    );
    expect(within(section).queryByText('Талх цагаан')).toBeNull();

    // 28,200 − 500 = 27,700: the 2+1's 2,000 is not in the discount.
    expect(valueOf(mn.pos.fields.subtotal)).toHaveTextContent('28,200');
    expect(valueOf(mn.pos.fields.discount)).toHaveTextContent('−500');
    expect(screen.getByText(r.grandTotal)).toBeInTheDocument();
    expect(screen.getByText(r.kinds.replace('{{count}}', '4'))).toBeInTheDocument();
    expect(screen.getByText(r.grandTotal).parentElement?.nextElementSibling).toHaveTextContent(
      '27,700₮',
    );
    expect(valueOf(r.promotionTotal)).toHaveTextContent('2,000₮');
    expect(screen.queryByText(mn.pos.fields.total)).toBeNull();
  });

  it('lists the free goods on a compact receipt too', () => {
    draw(layoutOf(true), false);
    const section = screen.getByRole('listitem', { name: r.promotion });
    expect(within(section).getByText('Саван гарын')).toBeInTheDocument();
    expect(within(section).getByText(/^1 ш × 2,000$/)).toBeInTheDocument();
  });

  it('prints a sale without free goods with its kinds and no promotion', () => {
    draw(layoutOf(false), false, (receipt) => ({
      ...receipt,
      lines: receipt.lines.slice(0, 3),
      subtotal: '24200.00',
      discountTotal: '500.00',
      total: '23700.00',
      promotionTotal: '0.00',
    }));
    expect(screen.queryByRole('region', { name: r.promotion })).toBeNull();
    expect(screen.queryByText(r.promotionTotal)).toBeNull();
    expect(screen.getByText(r.kinds.replace('{{count}}', '3'))).toBeInTheDocument();
    expect(valueOf(mn.pos.fields.discount)).toHaveTextContent('−500');
  });

  it('prints a receipt made before it as before', () => {
    draw(layoutOf(false), false, ({ promotionTotal: _promotion, ...receipt }) => ({
      ...receipt,
      lines: receipt.lines.map(({ bonus: _bonus, ...line }) => line),
    }));
    expect(screen.getByText('Саван гарын').nextElementSibling).toHaveTextContent(/^3$/);
    expect(screen.queryByRole('region', { name: r.promotion })).toBeNull();
    expect(screen.queryByText(r.grandTotal)).toBeNull();
    expect(screen.queryByText(/төрөл/)).toBeNull();
    expect(valueOf(mn.pos.fields.subtotal)).toHaveTextContent('30,200');
    expect(valueOf(mn.pos.fields.discount)).toHaveTextContent('−2,500');
    expect(valueOf(mn.pos.fields.total)).toHaveTextContent('27,700₮');
  });

  it('prints no promotion on a return', () => {
    draw(layoutOf(false), false, (receipt) => ({ ...receipt, kind: 'RETURN' }));
    expect(screen.queryByRole('region', { name: r.promotion })).toBeNull();
    expect(screen.queryByText(r.grandTotal)).toBeNull();
  });
});
