import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createCodeDetector } from '@/lib/scan/camera';

/** Time between two looks at the video; a code counts once two looks in a row read it. */
const SCAN_INTERVAL_MS = 150;

type CameraState = 'starting' | 'scanning' | 'denied' | 'missing' | 'failed';

function failureOf(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
}

const MESSAGES = {
  denied: 'scan.cameraDenied',
  missing: 'scan.cameraMissing',
  failed: 'scan.cameraFailed',
} as const;

/**
 * Reads a barcode with the device camera (ADR-0021 #2, ADR-0031): the back camera of a phone, any
 * camera of a laptop. The stream stops when the dialog closes.
 */
export function CameraScanner(props: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const onScan = useRef(props.onScan);
  useEffect(() => {
    onScan.current = props.onScan;
  });

  useEffect(() => {
    if (!props.open) return undefined;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    const start = async () => {
      setState('starting');
      try {
        const detector = await createCodeDetector();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const element = video.current;
        if (stopped || !element) {
          stop();
          return;
        }
        element.srcObject = stream;
        await element.play();
        setState('scanning');
        let previous: string | null = null;
        const look = async () => {
          if (stopped) return;
          if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const found = await detector.detect(element).catch(() => []);
            const value = found[0]?.rawValue ?? null;
            if (value !== null && value === previous) {
              onScan.current(value);
              return;
            }
            previous = value;
          }
          timer = window.setTimeout(() => void look(), SCAN_INTERVAL_MS);
        };
        void look();
      } catch (error) {
        stop();
        if (!stopped) setState(failureOf(error));
      }
    };
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [props.open]);

  const problem = state === 'starting' || state === 'scanning' ? null : MESSAGES[state];
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('scan.camera')}</DialogTitle>
          <DialogDescription>
            {state === 'starting' ? t('scan.cameraStarting') : t('scan.cameraHint')}
          </DialogDescription>
        </DialogHeader>
        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{t(problem)}</AlertDescription>
          </Alert>
        ) : (
          <video
            ref={video}
            className="aspect-[4/3] w-full rounded-md bg-black object-cover"
            muted
            playsInline
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
