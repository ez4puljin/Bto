import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FactChips, PanelSection } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty, formatTugrik } from '@/lib/money';
import type { ErxesDeal, ErxesDealLine } from './api';

const money = (value: string | null) => (value === null ? '' : formatTugrik(value));

/** What Bto says of a line, when the caller knows: the order's own price beside erxes's. */
export interface BtoLinePrice {
  unitPrice: string | null;
  total: string | null;
}

/**
 * A deal as erxes holds it (ADR-0218 #4): its name and number, who made it and who it is assigned
 * to, labels, custom fields under their erxes labels, the lines with erxes's prices, attachments
 * as links, a link to the deal in erxes, and the whole answer for whoever needs a value that has
 * no place above. `lineExtra` adds a cell to each line (a picker, Bto's price).
 */
export function ErxesDealView(props: {
  deal: ErxesDeal;
  /** Bto's price of the line a unit became (the order panel). */
  btoPrice?: (line: ErxesDealLine) => BtoLinePrice | null;
  /** Something to do with a line (the waiting list's product picker). */
  lineAction?: (line: ErxesDealLine) => ReactNode;
}) {
  const { t } = useTranslation();
  const { deal } = props;
  const facts: { label: string; value: ReactNode }[] = [
    ...(deal.number ? [{ label: t('erxes.deal.number'), value: deal.number }] : []),
    ...(deal.pipelineName ? [{ label: t('erxes.deal.pipeline'), value: deal.pipelineName }] : []),
    ...(deal.stageName ? [{ label: t('erxes.deal.stage'), value: deal.stageName }] : []),
    {
      label: t('erxes.deal.creator'),
      value: deal.creatorUserName
        ? t('erxes.deal.creatorBoth', {
            erxes: deal.creatorName ?? '',
            bto: deal.creatorUserName,
          })
        : (deal.creatorName ?? t('erxes.deal.unknown')),
    },
    ...(deal.erxesCreatedAt
      ? [{ label: t('erxes.deal.createdAt'), value: formatUbMinute(deal.erxesCreatedAt) }]
      : []),
    ...(deal.assigned.length > 0
      ? [{ label: t('erxes.deal.assigned'), value: deal.assigned.join(', ') }]
      : []),
    ...(deal.startDate
      ? [{ label: t('erxes.deal.startDate'), value: formatUbMinute(deal.startDate) }]
      : []),
    ...(deal.closeDate
      ? [{ label: t('erxes.deal.closeDate'), value: formatUbMinute(deal.closeDate) }]
      : []),
  ];
  const showBto = Boolean(props.btoPrice);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{deal.name ?? deal.erxesId}</span>
        {deal.labels.map((label) => (
          <Badge key={label.name} variant="secondary">
            {label.name}
          </Badge>
        ))}
        <a
          href={deal.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-sm text-link underline-offset-4 hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          {t('erxes.deal.openInErxes')}
        </a>
      </div>
      <FactChips facts={facts} />
      {deal.description ? (
        <PanelSection title={t('erxes.deal.description')}>
          <p className="text-sm whitespace-pre-line">{deal.description}</p>
        </PanelSection>
      ) : null}
      {deal.parties.length > 0 ? (
        <PanelSection title={t('erxes.deal.parties')}>
          <ul className="flex flex-col gap-1 text-sm">
            {deal.parties.map((party, index) => (
              <li key={`${party.kind}-${index}`}>
                <span className="text-muted-foreground">
                  {t(`erxes.deal.partyKind.${party.kind}`)}
                </span>{' '}
                {[party.name, party.code, party.regNo, ...party.phones].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {deal.customFields.length > 0 ? (
        <PanelSection title={t('erxes.deal.customFields')}>
          <FactChips
            facts={deal.customFields.map((field) => ({ label: field.label, value: field.value }))}
          />
        </PanelSection>
      ) : null}
      {deal.lines.length > 0 ? (
        <PanelSection title={t('erxes.deal.lines')}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-fill text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">{t('erxes.deal.line.product')}</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">
                    {t('erxes.deal.line.qty')}
                  </th>
                  <th className="px-2.5 py-1.5 text-right font-medium">
                    {t('erxes.deal.line.erxesPrice')}
                  </th>
                  <th className="px-2.5 py-1.5 text-right font-medium">
                    {t('erxes.deal.line.discount')}
                  </th>
                  <th className="px-2.5 py-1.5 text-right font-medium">
                    {t('erxes.deal.line.erxesAmount')}
                  </th>
                  <th className="px-2.5 py-1.5 font-medium">{t('erxes.deal.line.bto')}</th>
                  {showBto ? (
                    <>
                      <th className="px-2.5 py-1.5 text-right font-medium">
                        {t('erxes.deal.line.btoPrice')}
                      </th>
                      <th className="px-2.5 py-1.5 text-right font-medium">
                        {t('erxes.deal.line.btoAmount')}
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deal.lines.map((line, index) => {
                  const bto = props.btoPrice?.(line) ?? null;
                  return (
                    <tr key={`${line.erxesProductId ?? ''}-${index}`} className="align-top">
                      <td className="px-2.5 py-1.5">
                        <span className="font-mono text-muted-foreground">{line.code ?? ''}</span>{' '}
                        {line.name ?? ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap tabular-nums">
                        {line.quantity === null ? '' : formatQty(line.quantity)} {line.uom ?? ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {money(line.unitPrice)}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {line.discount !== null && line.discount !== '0'
                          ? `−${formatTugrik(line.discount)}`
                          : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {money(line.amount)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {line.unit ? (
                          <span>
                            <span className="font-mono text-muted-foreground">{line.unit.sku}</span>{' '}
                            {line.unit.productName} · {line.unit.unitName}
                          </span>
                        ) : null}
                        {props.lineAction?.(line)}
                      </td>
                      {showBto ? (
                        <>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">
                            {bto?.unitPrice ? formatTugrik(bto.unitPrice) : ''}
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">
                            {bto?.total ? formatTugrik(bto.total) : ''}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PanelSection>
      ) : null}
      {deal.attachments.length > 0 ? (
        <PanelSection title={t('erxes.deal.attachments')}>
          <ul className="flex flex-col gap-1 text-sm">
            {deal.attachments.map((file) => (
              <li key={file.url}>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link underline-offset-4 hover:underline"
                >
                  {file.name ?? file.url}
                </a>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t('erxes.deal.raw')}</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-fill p-3 text-xs">
          {JSON.stringify(deal.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}
