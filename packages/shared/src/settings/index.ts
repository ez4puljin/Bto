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
   * Days a customer app session lives without use (ADR-0079 #3: until sign-out or this many days
   * since the last refresh; Claude's default 90).
   */
  'auth.customer_session_days': { kind: 'integer', min: 1, max: 365, default: 90 },
  /**
   * Days a customer has to pay an invoice, the same for everyone unless a customer has its own
   * (owner answers 2026-10-11 and 2026-10-16: 30 days, ADR-0060 #2).
   */
  'credit.payment_term_days': { kind: 'integer', min: 0, max: 365, default: 30 },
  /**
   * The credit check's overdue rule (ADR-0073 #5): on, an overdue amount blocks only when it exceeds
   * the customer's open credits (payments and returns the accountant has not applied yet); off, any
   * overdue amount blocks (ADR-0060 #2).
   */
  'credit.overdue_nets_credits': { kind: 'boolean', default: true },
  /**
   * The Finance Core company this installation books into (ADR-0070 #2): set at installation and
   * never changed through the api (ADR-0084 #3; the PMS or a second Bto books into its own).
   */
  'bto.company_code': { kind: 'code', default: 'BO', locked: true },
} as const satisfies Record<string, SettingDefinition>;

export interface SettingDefinition {
  kind: 'percent' | 'boolean' | 'integer' | 'code';
  min?: number;
  max?: number;
  default?: string | boolean | number;
  /** Fixed at installation: the api refuses a new value (SETTING_NOT_EDITABLE). */
  locked?: boolean;
}

export type SettingKey = keyof typeof SETTINGS;

interface SettingKinds {
  /** A decimal string with at most two decimals, 0 to 100. */
  percent: string;
  boolean: boolean;
  integer: number;
  /** A Finance Core code: a letter or digit, then up to 63 of `A-Za-z0-9_.:-` (ADR-0071). */
  code: string;
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

/** Whether the api refuses new values for `key` (fixed at installation). */
export function isLockedSetting(key: SettingKey): boolean {
  const definition: SettingDefinition = SETTINGS[key];
  return definition.locked === true;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
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
    case 'code':
      if (typeof raw !== 'string') return { ok: false, problem: 'TYPE' };
      return CODE.test(raw)
        ? { ok: true, value: raw as SettingValueOf<K> }
        : { ok: false, problem: 'RANGE' };
  }
}
