import { Printer } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { expiryBarcodeBars } from './expiry-barcode-encoding';

export function ExpiryBarcodeLabel(props: {
  barcode: string;
  name: string;
  price: string;
  expiryDate: string;
}) {
  const { t } = useTranslation();
  const label = useRef<HTMLDivElement>(null);
  const { bars, width } = expiryBarcodeBars(props.barcode);
  const print = () => {
    if (!label.current) return;
    const frame = document.createElement('iframe');
    frame.title = t('expiry.commerce.printLabel');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.append(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      return;
    }
    const style = doc.createElement('style');
    style.textContent =
      '@page{size:58mm 40mm;margin:3mm}body{margin:0;font:11px sans-serif;text-align:center;color:#000}svg{display:block;width:100%;height:12mm}p{margin:2mm 0}';
    doc.head.append(style);
    doc.body.append(label.current.cloneNode(true));
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  return (
    <div className="flex flex-col gap-2">
      <div ref={label} className="max-w-72 rounded border bg-white p-3 text-center text-black">
        <p className="text-sm font-medium">{props.name}</p>
        <p className="text-xs">
          {t('expiry.commerce.variant')} · {props.expiryDate} · {props.price}
        </p>
        <svg
          role="img"
          aria-label={props.barcode}
          viewBox={`0 0 ${width} 40`}
          shapeRendering="crispEdges"
          className="my-2 h-10 w-full"
        >
          {bars.map((bar) => (
            <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={40} fill="currentColor" />
          ))}
        </svg>
        <p className="font-mono text-xs">{props.barcode}</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={print}>
        <Printer />
        {t('expiry.commerce.printLabel')}
      </Button>
    </div>
  );
}
