import type { components } from '@tugeel/api-client';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ErkhetLedgerLink } from './api';

type ErkhetEntry = components['schemas']['LedgerErkhetEntry'];

/** The kind of a ledger row that is a copy of Erkhet's books (ADR-0219). */
export function ErkhetKind({ erkhet, reversal }: { erkhet: ErkhetEntry; reversal: boolean }) {
  const { t } = useTranslation();
  if (reversal) return <>{t('erkhet.ledger.entry.reversal')}</>;
  return (
    <>{t(erkhet.kind === 'OPENING' ? 'erkhet.ledger.entry.opening' : 'erkhet.ledger.entry.kind')}</>
  );
}

/**
 * The document of a copied row: Erkhet's «Баримтын дугаар» and «Гүйлгээний утга». A transaction
 * opens in Erkhet in a new tab; an opening balance is no document there, so it has no link.
 */
export function ErkhetDocument({
  erkhet,
  number,
  link,
}: {
  erkhet: ErkhetEntry;
  number: string;
  link: ErkhetLedgerLink | undefined;
}) {
  const { t } = useTranslation();
  const label = erkhet.billNumber ?? number;
  return (
    <span className="flex min-w-0 flex-col">
      {link ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={t(link.exact ? 'erkhet.ledger.entry.open' : 'erkhet.ledger.entry.openList')}
          className="inline-flex items-center gap-1 text-link underline-offset-2 hover:underline"
        >
          <span className="truncate">{label}</span>
          <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">{t('erkhet.ledger.entry.newTab')}</span>
        </a>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {erkhet.text ? (
        <span className="truncate font-sans text-xs text-muted-foreground" title={erkhet.text}>
          {erkhet.text}
        </span>
      ) : null}
    </span>
  );
}
