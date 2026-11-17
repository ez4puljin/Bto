import { describe, expect, it } from 'vitest';
import {
  formatSmsAmount,
  renderSmsTemplate,
  SMS_DEFAULT_TEMPLATE,
  smsSize,
  unknownSmsPlaceholders,
} from './index';

const values = { name: 'Дэлгүүр А', code: 'C001', balance: '1250000.00', dueDate: '2026-11-20' };

describe('renderSmsTemplate', () => {
  it('fills every placeholder for one customer', () => {
    expect(renderSmsTemplate(SMS_DEFAULT_TEMPLATE, values)).toBe(
      'Сайн байна уу, Дэлгүүр А. Таны тооцооны үлдэгдэл 1,250,000 төг байна. Бүтэн-Оргил ХХК',
    );
    expect(renderSmsTemplate('{Харилцагч_код} {Тооцооны_өдөр} {Харилцагч_код}', values)).toBe(
      'C001 2026.11.20 C001',
    );
  });

  it('leaves an unknown placeholder as typed and names it', () => {
    expect(renderSmsTemplate('{Утас} {Харилцагч_нэр}', values)).toBe('{Утас} Дэлгүүр А');
    expect(unknownSmsPlaceholders('{Утас} {Харилцагч_нэр} {} {Утас}')).toEqual(['Утас', '']);
    expect(unknownSmsPlaceholders(SMS_DEFAULT_TEMPLATE)).toEqual([]);
  });
});

describe('formatSmsAmount', () => {
  it('writes whole MNT with thousands separators, rounded half up', () => {
    expect(formatSmsAmount('1250000.00')).toBe('1,250,000');
    expect(formatSmsAmount('999.50')).toBe('1,000');
    expect(formatSmsAmount('999.49')).toBe('999');
    expect(formatSmsAmount('0')).toBe('0');
    expect(formatSmsAmount('-15000.00')).toBe('-15,000');
    expect(formatSmsAmount('-0.40')).toBe('0');
  });
});

describe('smsSize', () => {
  it('counts a Latin text in parts of 155', () => {
    expect(smsSize('')).toMatchObject({ parts: 0, cost: 0 });
    expect(smsSize('a'.repeat(155))).toMatchObject({ encoding: 'LATIN', parts: 1, cost: 80 });
    expect(smsSize('a'.repeat(156))).toMatchObject({ encoding: 'LATIN', parts: 2, cost: 160 });
    expect(smsSize('Hello,\nworld!')).toMatchObject({ encoding: 'LATIN', characters: 13 });
  });

  it('turns Unicode for Cyrillic, signs and the ASCII WeSend does not count as Latin', () => {
    for (const char of ['б', '₮', '№', '«', '»', '“', '[', '\\', ']', '^', '{', '|', '}', '~']) {
      expect(smsSize(`abc${char}`).encoding).toBe('UNICODE');
    }
    expect(smsSize('б'.repeat(65))).toMatchObject({ parts: 1, cost: 80, tooLong: false });
    expect(smsSize('б'.repeat(66))).toMatchObject({ parts: 2, cost: 160 });
  });

  it('refuses more than four parts', () => {
    expect(smsSize('б'.repeat(260))).toMatchObject({ parts: 4, tooLong: false });
    expect(smsSize('б'.repeat(261))).toMatchObject({ parts: 5, tooLong: true });
    expect(smsSize('a'.repeat(621)).tooLong).toBe(true);
  });

  it('counts the default text for a real customer in two Unicode parts', () => {
    const text = renderSmsTemplate(SMS_DEFAULT_TEMPLATE, values);
    expect(smsSize(text)).toMatchObject({ encoding: 'UNICODE', parts: 2, cost: 160 });
  });
});
