import { useMemo } from 'react';
import { code128CModules } from './code128';

/**
 * A Code 128 (set C) barcode as inline SVG: black bars in `currentColor` with a quiet zone of
 * `quiet` modules on each side. Size it with `className`; the bars stretch to the box.
 */
export function Code128Svg({
  value,
  label,
  quiet = 10,
  className,
}: {
  /** An even-length string of digits. */
  value: string;
  /** The accessible name (the code as printed under the bars). */
  label: string;
  quiet?: number;
  className?: string;
}) {
  const bars = useMemo(() => {
    const result: { x: number; width: number }[] = [];
    let x = quiet;
    code128CModules(value).forEach((width, index) => {
      if (index % 2 === 0) result.push({ x, width });
      x += width;
    });
    return { result, total: x + quiet };
  }, [value, quiet]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${bars.total} 40`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
    >
      {bars.result.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={40} fill="currentColor" />
      ))}
    </svg>
  );
}
