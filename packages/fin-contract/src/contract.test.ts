import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIN_ERROR_CODES,
  FIN_HELD_CODES,
  FIN_PERMISSIONS,
  FIN_RETRYABLE_CODES,
  type IntakeCommandV1,
  IntakeCommandV1Schema,
  IntakeResultV1Schema,
  isFinErrorCode,
  TaxRateV1Schema,
} from './index';

const FIXTURES = join(__dirname, '..', 'fixtures', 'intake', '1.0');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const files = readdirSync(FIXTURES);
const commands = files.filter((name) => name.endsWith('.command.json'));
const results = files.filter((name) => name.endsWith('.result.json'));

/** A valid command to break one field at a time. */
const invoice = () => structuredClone(fixture('bto-sales-invoice.command.json')) as IntakeCommandV1;
const postBody = (command: IntakeCommandV1) => {
  if (command.body.action !== 'POST') throw new Error('a POST fixture');
  return command.body;
};
const refused = (value: unknown) => IntakeCommandV1Schema.safeParse(value).success === false;

describe('fin.intake/1.0 fixtures parse forever (ADR-0071 #11)', () => {
  it('has the fixtures of docs/modules/finance-core.md §14', () => {
    expect(commands.length).toBeGreaterThanOrEqual(8);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it.each(commands)('%s', (name) => {
    const parsed = IntakeCommandV1Schema.safeParse(fixture(name));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each(results)('%s', (name) => {
    const parsed = IntakeResultV1Schema.safeParse(fixture(name));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('the command schema is strict', () => {
  it('refuses unknown fields on the envelope, the body and a line', () => {
    expect(refused({ ...invoice(), extra: 1 })).toBe(true);
    const body = invoice();
    Object.assign(postBody(body), { extra: 1 });
    expect(refused(body)).toBe(true);
    const line = invoice();
    Object.assign(postBody(line).lines[0] ?? {}, { extra: 1 });
    expect(refused(line)).toBe(true);
  });

  it('takes amounts only as decimal strings with at most two places, lines above zero', () => {
    for (const amount of [110000, '110000.001', '-5.00', '0.00', '1e5', '']) {
      const command = invoice();
      Object.assign(postBody(command).lines[0] ?? {}, { amount });
      expect(refused(command)).toBe(true);
    }
    const whole = invoice();
    Object.assign(postBody(whole).lines[0] ?? {}, { amount: '110000' });
    expect(refused(whole)).toBe(false);
  });

  it('accepts only contract 1.x, a uuid v7 command id and real dates', () => {
    expect(refused({ ...invoice(), contract: 'fin.intake/2.0' })).toBe(true);
    expect(refused({ ...invoice(), contract: 'fin.intake/1.7' })).toBe(false);
    expect(refused({ ...invoice(), commandId: '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f' })).toBe(true);
    const date = invoice();
    postBody(date).documentDate = '2026-02-30';
    expect(refused(date)).toBe(true);
  });

  it('needs 2 lines without an allocation and none with one', () => {
    const one = invoice();
    postBody(one).lines = postBody(one).lines.slice(0, 1);
    expect(refused(one)).toBe(true);
    const both = invoice();
    postBody(both).allocate = {
      key: 'AR',
      pairs: [{ debit: { itemId: '1' }, credit: { itemId: '2' }, amount: '1.00' }],
    };
    expect(refused(both)).toBe(true);
  });

  it('refuses repeated line numbers and more than 20 attributes', () => {
    const repeated = invoice();
    const lines = postBody(repeated).lines;
    if (lines[1]) lines[1].lineNo = 1;
    expect(refused(repeated)).toBe(true);
    const many = invoice();
    postBody(many).attributes = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`k${index}`, 'v']),
    );
    expect(refused(many)).toBe(true);
  });

  it('refuses control characters in texts', () => {
    const command = invoice();
    postBody(command).description = `a${String.fromCharCode(10)}b`;
    expect(refused(command)).toBe(true);
  });
});

describe('codes', () => {
  it('names every error FIN_* in UPPER_SNAKE_CASE, once', () => {
    expect(new Set(FIN_ERROR_CODES).size).toBe(FIN_ERROR_CODES.length);
    for (const code of FIN_ERROR_CODES) expect(code).toMatch(/^FIN_[A-Z]+(_[A-Z]+)*$/);
    for (const code of [...FIN_RETRYABLE_CODES, ...FIN_HELD_CODES]) {
      expect(isFinErrorCode(code)).toBe(true);
    }
    expect(isFinErrorCode('NOT_FOUND')).toBe(false);
  });

  it('names every right finance.*, once', () => {
    expect(new Set(FIN_PERMISSIONS).size).toBe(FIN_PERMISSIONS.length);
    for (const permission of FIN_PERMISSIONS)
      expect(permission).toMatch(/^finance\.[a-z]+(\.[a-z]+)?$/);
  });

  it('keeps tax rates between 0 and 100', () => {
    const rate = { company: 'BO', code: 'MN.VAT.STD', effectiveFrom: '2026-01-01' };
    expect(TaxRateV1Schema.safeParse({ ...rate, ratePct: '10' }).success).toBe(true);
    expect(TaxRateV1Schema.safeParse({ ...rate, ratePct: '100.00' }).success).toBe(true);
    expect(TaxRateV1Schema.safeParse({ ...rate, ratePct: '100.01' }).success).toBe(false);
    expect(TaxRateV1Schema.safeParse({ ...rate, ratePct: '-1' }).success).toBe(false);
  });
});
