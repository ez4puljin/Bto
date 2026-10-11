/**
 * Effective-dated settings (SPEC §5.1, ADR-0010 #7, ADR-0027). Each key is also the i18n key
 * `settings.keys.<key>` in mn.json. Tax rates and payer flags have no default on purpose: VAT and
 * city-tax rates are never hard-coded (CLAUDE.md), so reading a missing one is an error.
 */
export const SETTINGS = {
  /** VAT rate in percent, e.g. "10" (SPEC §11 #3a). */
  'tax.vat_rate_pct': { kind: 'percent' },
  /** City tax (НХАТ) rate in percent, e.g. "2" (SPEC §11 #3a). */
  'tax.city_tax_rate_pct': { kind: 'percent' },
  /** The company is a VAT payer. */
  'company.vat_payer': { kind: 'boolean' },
  /** The company is a city-tax payer. */
  'company.city_tax_payer': { kind: 'boolean' },
  /** Lifetime of a staff login in hours, counted from the login (owner answer 2026-10-10). */
  'auth.staff_session_hours': { kind: 'integer', min: 1, max: 168, default: 12 },
  /**
   * Days a customer has to pay an invoice, the same for everyone unless a customer has its own
   * (owner answer 2026-10-11; the number is the accountant's, TODO-VERIFY before delivery 3).
   */
  'credit.payment_term_days': { kind: 'integer', min: 0, max: 365 },
} as const satisfies Record<string, SettingDefinition>;

export interface SettingDefinition {
  kind: 'percent' | 'boolean' | 'integer';
  min?: number;
  max?: number;
  default?: string | boolean | number;
}

export type SettingKey = keyof typeof SETTINGS;

interface SettingKinds {
  /** A decimal string with at most two decimals, 0 to 100. */
  percent: string;
  boolean: boolean;
  integer: number;
}

export type SettingValueOf<K extends SettingKey> = SettingKinds[(typeof SETTINGS)[K]['kind']];
export type SettingValue = SettingKinds[keyof SettingKinds];

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && Object.hasOwn(SETTINGS, value);
}

export function settingDefault<K extends SettingKey>(key: K): SettingValueOf<K> | undefined {
  const definition: SettingDefinition = SETTINGS[key];
  return definition.default as SettingValueOf<K> | undefined;
}

const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

export type SettingValueProblem = 'TYPE' | 'RANGE';

/** Validates a raw value for a key; returns the stored form or the reason it was rejected. */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
): { ok: true; value: SettingValueOf<K> } | { ok: false; problem: SettingValueProblem } {
  const definition: SettingDefinition = SETTINGS[key];
  switch (definition.kind) {
    case 'percent':
      if (typeof raw !== 'string') return { ok: false, problem: 'TYPE' };
      return PERCENT.test(raw)
        ? { ok: true, value: raw as SettingValueOf<K> }
        : { ok: false, problem: 'RANGE' };
    case 'boolean':
      return typeof raw === 'boolean'
        ? { ok: true, value: raw as SettingValueOf<K> }
        : { ok: false, problem: 'TYPE' };
    case 'integer':
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return { ok: false, problem: 'TYPE' };
      if (
        (definition.min !== undefined && raw < definition.min) ||
        (definition.max !== undefined && raw > definition.max)
      ) {
        return { ok: false, problem: 'RANGE' };
      }
      return { ok: true, value: raw as SettingValueOf<K> };
  }
}
