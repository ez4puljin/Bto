import pg from 'pg';

/**
 * node-postgres already returns NUMERIC (OID 1700) as text. Pin that explicitly, so no library can
 * switch it to parseFloat: money and quantities must never become JS numbers (ADR-0010).
 */
export function configurePgTypeParsers(): void {
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => value);
}
