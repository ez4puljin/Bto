import { render, screen } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import { defaultReceiptLayout, type ReceiptLayout } from '@tugeel/shared/pos';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { sampleReceipt } from '@/features/pos/receipt-sample';
import { i18n } from '@/lib/i18n';
import { ReceiptView } from './components/receipt-view';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function draw(layout: ReceiptLayout, member: boolean) {
  const receipt = sampleReceipt(
    'SALE',
    { test: false, company: false, credit: false, member },
    null,
    'Оргил',
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
