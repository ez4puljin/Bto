import type { ApiClient } from '@tugeel/api-client';
import { escposOf, fetchJob, type PrintItem, startPcPrint } from './api';
import { sendToPrinter } from './bluetooth';
import { bytesOfBase64 } from './escpos';
import { waitForJob } from './job';
import type { PrinterChoice } from './prefs';

/** The i18n key under `mobile.labels.errors` a failed print shows; `detail` is the printer's own words. */
export class PrintFailure extends Error {
  readonly failure: 'pcFailed' | 'pcTimeout' | 'badBytes';
  /** The server's error code of a failed job (`errors.<code>`), when it gave one. */
  readonly code: string | null;
  readonly detail: string | null;

  constructor(
    failure: PrintFailure['failure'],
    detail: string | null = null,
    code: string | null = null,
  ) {
    super(failure);
    this.name = 'PrintFailure';
    this.failure = failure;
    this.detail = detail;
    this.code = code;
  }
}

/** 80 mm paper at 203 dpi is 576 dots. */
const WIDTH_80MM = 576;

const clock = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Prints the items on the chosen printer and gives back how many labels went out. A Bluetooth
 * printer gets the server's ESC/POS bytes from the phone; a PC printer is a job the server queues
 * and this waits for. Throws an `ApiProblem`, a `BluetoothError` or a `PrintFailure`.
 */
export async function printLabels(
  client: ApiClient,
  tillId: number,
  printer: PrinterChoice,
  items: PrintItem[],
): Promise<number> {
  if (printer.kind === 'bluetooth') {
    const made = await escposOf(client, { tillId, items, widthDots: WIDTH_80MM });
    const bytes = bytesOfBase64(made.data);
    if (!bytes || bytes.length === 0) throw new PrintFailure('badBytes');
    await sendToPrinter(printer.address, bytes);
    return made.labels;
  }
  const started = await startPcPrint(client, { tillId, stationId: printer.stationId, items });
  const outcome = await waitForJob(() => fetchJob(client, started.jobId), clock);
  if (!outcome.ok) {
    throw new PrintFailure(
      outcome.reason === 'timeout' ? 'pcTimeout' : 'pcFailed',
      outcome.detail,
      outcome.error,
    );
  }
  return started.labels;
}
