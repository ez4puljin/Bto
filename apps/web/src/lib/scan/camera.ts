import type { BarcodeFormat } from 'barcode-detector/ponyfill';

/**
 * Barcode types the web scanner reads (ADR-0021 #2): retail codes, ITF-14 on cartons, Code 128
 * labels and QR. The names are those of the Barcode Detection API.
 */
export const SCAN_FORMATS: BarcodeFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'code_128',
  'qr_code',
];

export interface CodeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface NativeBarcodeDetector {
  new (options: { formats: string[] }): CodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

/** Browsers open a camera only for HTTPS pages and localhost. */
export function cameraAvailable(): boolean {
  return (
    window.isSecureContext &&
    typeof navigator.mediaDevices === 'object' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * The browser's own BarcodeDetector when it reads every format (Chrome on Android), otherwise ZXing
 * compiled to WebAssembly. The .wasm file is part of our build and served by us, never by a CDN
 * (ADR-0031); both are loaded only when a camera scanner opens.
 */
export async function createCodeDetector(): Promise<CodeDetector> {
  const native = (globalThis as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector;
  if (native) {
    const supported = await native.getSupportedFormats();
    if (SCAN_FORMATS.every((format) => supported.includes(format))) {
      return new native({ formats: SCAN_FORMATS });
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: SCAN_FORMATS });
}
