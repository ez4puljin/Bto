// The printing module's fixed rules (ADR-0226). Only the api uses them: the staff app and the web
// read the shapes from the OpenAPI document.

/** NETWORK: a LAN printer the api writes to; BRIDGE: a printer on a Windows PC behind its bridge. */
export const PRINT_STATION_KINDS = ['BRIDGE', 'NETWORK'] as const;
export type PrintStationKind = (typeof PRINT_STATION_KINDS)[number];

export const PRINT_STATION_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type PrintStationStatus = (typeof PRINT_STATION_STATUSES)[number];

export const PRINT_JOB_STATUSES = ['QUEUED', 'PRINTING', 'DONE', 'FAILED'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** Dots across the paper: 80 mm paper prints 72 mm at 203 dpi; 58 mm paper 48 mm. */
export const PRINT_WIDTHS = [576, 384] as const;
export type PrintWidth = (typeof PRINT_WIDTHS)[number];

export const PRINT_LIMITS = {
  nameMax: 80,
  /** Copies of one product's label in one print (the old system's 1–20). */
  maxCopies: 20,
  /** Labels in one print (the old system's 100). */
  maxLabels: 100,
  /** Products in one print. */
  maxItems: 100,
  /** Products a search answers. */
  searchLimit: 30,
  /** A job no printer took within this many seconds fails PRINTER_OFFLINE. */
  pickupSeconds: 120,
  /** A station whose bridge called within this many seconds is online. */
  onlineSeconds: 60,
  /** How long the bridge's `next` call waits for a job before answering 204. */
  longPollMs: 25_000,
  /** The api's TCP send to a NETWORK printer. */
  socketTimeoutMs: 8_000,
  defaultPort: 9100,
} as const;

/** The error codes a job ends with; the clients show `errors.<code>` of mn.json. */
export const PRINT_JOB_ERRORS = [
  'PRINTER_OFFLINE',
  'PRINTER_UNREACHABLE',
  'PRINTER_REFUSED',
] as const;
