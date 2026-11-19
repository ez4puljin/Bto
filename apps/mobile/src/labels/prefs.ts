import { userKey } from '../device/keys';

// What «Үнийн шошго» remembers about the seller's choices: the till and the printer.

export type PrinterChoice =
  { kind: 'bluetooth'; address: string; name: string } | { kind: 'pc'; stationId: number };

export interface LabelPrefs {
  tillId: number | null;
  printer: PrinterChoice | null;
}

export const EMPTY_PREFS: LabelPrefs = { tillId: null, printer: null };

export const prefsKey = (server: string, userId: number) => userKey('labelPrefs', server, userId);

export function prefsFrom(stored: unknown): LabelPrefs {
  if (typeof stored !== 'object' || stored === null) return EMPTY_PREFS;
  const value = stored as Record<string, unknown>;
  const tillId = typeof value.tillId === 'number' ? value.tillId : null;
  const printer = value.printer as Record<string, unknown> | null | undefined;
  if (printer && printer.kind === 'bluetooth') {
    if (typeof printer.address === 'string' && typeof printer.name === 'string') {
      return {
        tillId,
        printer: { kind: 'bluetooth', address: printer.address, name: printer.name },
      };
    }
  } else if (printer && printer.kind === 'pc' && typeof printer.stationId === 'number') {
    return { tillId, printer: { kind: 'pc', stationId: printer.stationId } };
  }
  return { tillId, printer: null };
}
