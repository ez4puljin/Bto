import { cleanBarcode } from '@tugeel/shared/gtin';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CameraScanner } from '@/components/camera-scanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { withLayoutDigit, withScanChar } from '@/lib/barcode-keys';
import { cameraAvailable } from '@/lib/scan/camera';
import { useWedgeScanner } from '@/lib/scan/use-wedge-scanner';

/**
 * The visible scan box (ADR-0021 #1): a keyboard-wedge scanner works with or without focus here,
 * a code can be typed, and where the page may open a camera a button reads one with it. With
 * `letters` it also reads shelf labels ("A-01-03") whatever the keyboard layout.
 */
export function ScanBox(props: {
  onScan: (code: string) => void;
  letters?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const { onScan, letters = false } = props;
  const [draft, setDraft] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [canUseCamera] = useState(cameraAvailable);
  const [insecure] = useState(() => !window.isSecureContext);
  const submit = (text: string) => {
    const code = cleanBarcode(text);
    setDraft('');
    if (code) onScan(code);
  };
  useWedgeScanner(submit, !cameraOpen, { letters });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          aria-label={props.label ?? t('scan.label')}
          className="max-w-sm font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder={props.placeholder ?? t('scan.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit(draft);
              return;
            }
            const typed = letters ? withScanChar(event, draft) : withLayoutDigit(event, draft);
            if (typed !== null) setDraft(typed);
          }}
        />
        <Button type="button" variant="outline" onClick={() => submit(draft)}>
          {t('scan.check')}
        </Button>
        {canUseCamera ? (
          <Button type="button" variant="outline" onClick={() => setCameraOpen(true)}>
            <Camera />
            <span className="sr-only sm:not-sr-only">{t('scan.camera')}</span>
          </Button>
        ) : null}
      </div>
      {insecure ? (
        <p className="text-xs text-muted-foreground">{t('scan.cameraNeedsHttps')}</p>
      ) : null}
      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => {
          setCameraOpen(false);
          submit(code);
        }}
      />
    </div>
  );
}
