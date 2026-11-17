/** `fetch` as the scanner's client uses it; tests give a scripted one, never a device. */
export type ScannerFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where the sheet lies: on the glass, or in the feeder on top. */
export const SCAN_SOURCES = ['GLASS', 'FEEDER'] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

/** What a device says about itself (eSCL `ScannerCapabilities`). */
export interface ScannerFacts {
  /** The maker's name of the device, as it reports it. */
  model: string | null;
  glass: boolean;
  feeder: boolean;
}

/** A scanned sheet: a JPEG as the device made it. */
export interface ScannedPage {
  jpeg: Buffer;
}

export const SCANNER_ERROR_REASONS = [
  /** The address does not answer within the time limit. */
  'TIMEOUT',
  /** No connection: a wrong address, the device off or on another network. */
  'NETWORK',
  /** The device answered with an error status. */
  'HTTP',
  /** The address answers, but not as a scanner (no eSCL / AirScan). */
  'NOT_A_SCANNER',
  /** The device is scanning for somebody else, or its lid or feeder is in trouble. */
  'BUSY',
  /** The feeder was asked and holds no sheet. */
  'NO_PAPER',
  /** The device has no such source (a feeder on a flatbed-only device). */
  'NO_SOURCE',
  /** What came back is not a picture. */
  'INVALID_RESPONSE',
] as const;
export type ScannerErrorReason = (typeof SCANNER_ERROR_REASONS)[number];

/** A failed exchange with the scanner: a reason and the device's status, never a body. */
export class ScannerError extends Error {
  readonly reason: ScannerErrorReason;
  readonly status?: number;

  constructor(reason: ScannerErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'ScannerError';
    this.reason = reason;
    this.status = status;
  }
}
