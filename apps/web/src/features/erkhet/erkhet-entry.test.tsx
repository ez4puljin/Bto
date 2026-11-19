import { render as renderBare, screen } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import { ErkhetDocument, ErkhetKind } from './erkhet-entry';

const render = (ui: ReactElement) =>
  renderBare(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

const TR = { kind: 'TR' as const, key: '120101:2001', billNumber: 'T-001', text: 'Туршилтын утга' };
const OPENING = { kind: 'OPENING' as const, key: null, billNumber: null, text: null };

describe('a ledger row copied from Erkhet (ADR-0219)', () => {
  it('opens the transaction in Erkhet in a new tab, with the bill number and the text', () => {
    render(
      <ErkhetDocument
        erkhet={TR}
        number="601"
        link={{ key: TR.key, url: 'https://erkhet.test/1/debt/trs/update/2001/', exact: true }}
      />,
    );
    const link = screen.getByRole('link', { name: /T-001/ });
    expect(link).toHaveAttribute('href', 'https://erkhet.test/1/debt/trs/update/2001/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', mn.erkhet.ledger.entry.open);
    expect(screen.getByText('Туршилтын утга')).toBeInTheDocument();
  });

  it('shows an opening balance, and a transaction without an address, without a link', () => {
    render(
      <>
        <p>
          <ErkhetKind erkhet={OPENING} reversal={false} />
        </p>
        <ErkhetDocument erkhet={OPENING} number="120101-90001" link={undefined} />
        <p>
          <ErkhetKind erkhet={TR} reversal={false} />
        </p>
        <ErkhetDocument erkhet={TR} number="601" link={undefined} />
      </>,
    );
    expect(screen.getByText(mn.erkhet.ledger.entry.opening)).toBeInTheDocument();
    expect(screen.getByText(mn.erkhet.ledger.entry.kind)).toBeInTheDocument();
    expect(screen.getByText('120101-90001')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
