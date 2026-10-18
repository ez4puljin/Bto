import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PrintFormatToggle } from '@/components/print-format-toggle';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  PAGE_RULES,
  type PrintFormat,
  parsePrintFormat,
  printFormatParam,
  usePrintFormat,
} from '@/lib/print-format';
import { problemFromError } from '@/lib/problem';

/**
 * The paper of every printable page (ADR-0058; one frame since ADR-0066): `?format=` or this
 * computer's choice, its `@page`, an A4 sheet or an 80 mm strip on the screen. Above the paper,
 * off the printout: «A4 | 80 мм», then «Хэвлэх» (enabled once the document is in) and «Хаах».
 * The browser's print dialog opens once, when the document is ready; a later render never cancels
 * the pending print.
 */
export function PrintFrame({
  ready,
  error,
  title,
  printLabel,
  children,
}: {
  ready: boolean;
  error: unknown;
  title: string;
  /** The print button's name when the page names it itself («Хэвлэх» otherwise). */
  printLabel?: string;
  children: (narrow: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const [saved, choose] = usePrintFormat();
  const format = parsePrintFormat(search.get('format')) ?? saved;
  const narrow = format === 'MM80';
  const printed = useRef(false);
  useEffect(() => {
    if (ready) document.title = title;
  }, [ready, title]);
  useEffect(() => {
    if (!ready || printed.current) return;
    const timer = window.setTimeout(() => {
      printed.current = true;
      window.print();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const change = (next: PrintFormat) => {
    choose(next);
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        params.set('format', printFormatParam(next));
        return params;
      },
      { replace: true },
    );
  };
  return (
    <div className="p-6 text-foreground print:p-0">
      <style>{PAGE_RULES[format]}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2 print:hidden">
        <PrintFormatToggle value={format} onChange={change} />
        <Button disabled={!ready} onClick={() => window.print()}>
          {printLabel ?? t('common.print')}
        </Button>
        <Button variant="outline" onClick={() => window.close()}>
          {t('common.close')}
        </Button>
      </div>
      <div className="mx-auto max-w-3xl">
        <ProblemAlert problem={problemFromError(error)} />
      </div>
      <div
        data-format={format}
        className={
          narrow
            ? 'mx-auto w-[80mm] max-w-full bg-background px-[4mm] py-[3mm] text-xs leading-snug shadow-card print:mx-0 print:w-full print:max-w-[80mm] print:shadow-none'
            : 'mx-auto max-w-3xl bg-background p-6 text-sm print:max-w-none print:p-0'
        }
      >
        {children(narrow)}
      </div>
    </div>
  );
}
