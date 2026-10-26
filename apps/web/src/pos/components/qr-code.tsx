import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code as crisp squares (e-Barimt asks for a sharp code); the data is never kept. */
export function QrCode({ data, label }: { data: string; label: string }) {
  const path = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(data);
    code.make();
    const count = code.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`;
      }
    }
    return { d, size: count + 8 };
  }, [data]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${path.size} ${path.size}`}
      shapeRendering="crispEdges"
      className="mx-auto block size-40 bg-background text-foreground print:size-[38mm]"
    >
      <path d={path.d} fill="currentColor" />
    </svg>
  );
}
