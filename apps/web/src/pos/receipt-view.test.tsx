import { render, screen } from '@testing-library/react';
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

  it.each([false, true])(
    'prints the threshold under the lines that have one (compact %s)',
    (compact) => {
      const base = defaultReceiptLayout();
      draw(
        {
          ...base,
          blocks: base.blocks.map((block) =>
            block.type === 'LINES' ? { ...block, compact } : block,
          ),
        },
        false,
        withLines,
      );
      expect(screen.getByText('Бөөний үнэ · 6 ш-ээс дээш')).toBeInTheDocument();
      expect(screen.getByText('6 ш-ээс бөөний 18,010₮')).toBeInTheDocument();
      expect(notes()).toHaveLength(2);
    },
  );

  it('prints none on a return', () => {
    draw(defaultReceiptLayout(), false, (receipt) => ({
      ...withLines(receipt),
      kind: 'RETURN',
    }));
    expect(notes()).toHaveLength(0);
  });
});
