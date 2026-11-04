import { ExternalLink, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePrint } from './print-context';

/** Windows' own printers page; Chrome asks once before it opens Settings. */
const WINDOWS_PRINTERS = 'ms-settings:printers';

/**
 * «Тохиргоо» of the POS app on the cashier's PC (owner 2026-11-04): the receipt printer is this
 * PC's, chosen here and never in the admin. The page prints with Chrome (ADR-0065, ADR-0111): the
 * printer is Windows' default one — or the one picked in Chrome's print window, which Chrome keeps —
 * and a test slip shows it works.
 */
export function SettingsDialog(props: {
  open: boolean;
  tillName: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const { printTest } = usePrint();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.settings.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.settings.description')}</DialogDescription>
        </DialogHeader>
        <section aria-labelledby="settings-printer" className="flex flex-col gap-3">
          <h2 id="settings-printer" className="text-base font-semibold">
            {t('posKiosk.settings.printer')}
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-[0.9375rem]">
            <li>{t('posKiosk.settings.stepDefault')}</li>
            <li>{t('posKiosk.settings.stepTest')}</li>
            <li>{t('posKiosk.settings.stepSilent')}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="lg" className="h-11">
              <a href={WINDOWS_PRINTERS}>
                <ExternalLink />
                {t('posKiosk.settings.openWindows')}
              </a>
            </Button>
            <Button
              size="lg"
              className="h-11"
              onClick={() => printTest(props.tillName, new Date().toISOString())}
            >
              <Printer />
              {t('posKiosk.menu.printTest')}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
