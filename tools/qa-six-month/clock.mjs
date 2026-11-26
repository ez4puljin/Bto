import { assertClientTarget, assertQaUrl } from './safety.mjs';
import { FIRST_DAY, LAST_DAY } from './dataset.mjs';

const CLOCK_SQL = /^\s*SELECT\s+now\(\)\s+AS\s+now\s*;?\s*$/i;

/**
 * Only the dedicated seed process loads this adapter. It never rewrites SQL or database clocks.
 * The exact SELECT is executed normally, then its one returned application-clock value is replaced.
 * SQL defaults, createdAt, audit timestamps, constraints and every other query remain untouched.
 */
export function installLogicalClock({ Client, time, databaseUrl, nodeEnv, explicitlyEnabled }) {
  if (nodeEnv !== 'test' || explicitlyEnabled !== true)
    throw new Error('Logical clock requires explicit isolated test bootstrap');
  assertQaUrl(databaseUrl);
  let instant = new Date(`${FIRST_DAY}T08:00:00+08:00`);
  const undo = [];
  let restored = false;
  const patch = (object, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || descriptor.writable !== true || !Object.hasOwn(descriptor, 'value'))
      throw new Error(`Cannot safely patch QA clock property ${key}`);
    undo.push(() => Object.defineProperty(object, key, descriptor));
    Object.defineProperty(object, key, { ...descriptor, value });
  };
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const revert of undo.reverse()) revert();
  };
  try {
    for (const name of ['businessDate', 'businessYear', 'businessMonthStart']) {
      const original = time[name];
      if (typeof original !== 'function') throw new Error(`Missing shared clock ${name}`);
      patch(time, name, (at) => original(at === undefined ? new Date(instant) : at));
    }
    const inZone = time.businessDateIn;
    if (typeof inZone !== 'function') throw new Error('Missing shared zoned clock');
    patch(time, 'businessDateIn', (zone, at) =>
      inZone(zone, at === undefined ? new Date(instant) : at),
    );
    const connect = Client.prototype.connect;
    patch(Client.prototype, 'connect', function (...args) {
      assertClientTarget(this);
      return connect.apply(this, args);
    });
    const query = Client.prototype.query;
    patch(Client.prototype, 'query', function (...input) {
      // Every seed-process query is restricted too, including a client connected before installation.
      assertClientTarget(this);
      const first = input[0];
      const text = typeof first === 'string' ? first : first?.text;
      if (!CLOCK_SQL.test(text ?? '')) return query.apply(this, input);
      const options = typeof first === 'object' ? first : {};
      if (
        options === null ||
        typeof options.submit === 'function' ||
        !['Object', undefined].includes(options.constructor?.name)
      )
        throw new Error('Unsupported exact clock-query object');
      const values = options.values ?? (Array.isArray(input[1]) ? input[1] : []);
      if (values.length || (options.rowMode !== undefined && options.rowMode !== 'array'))
        throw new Error('Unsupported exact clock-query shape');
      const chosen = new Date(instant);
      const replace = (result) => {
        if (!result || !Array.isArray(result.rows) || result.rows.length !== 1)
          throw new Error('Exact clock SELECT must return one row');
        const row = result.rows[0];
        if (Array.isArray(row)) {
          if (row.length !== 1) throw new Error('Clock array row must contain one field');
          return { ...result, rows: [[new Date(chosen)]] };
        }
        if (!Object.hasOwn(row, 'now') || Object.keys(row).length !== 1)
          throw new Error('Clock object row must contain only now');
        return { ...result, rows: [{ now: new Date(chosen) }] };
      };
      const callbackIndex = input.findLastIndex((arg) => typeof arg === 'function');
      if (callbackIndex !== -1) {
        const callback = input[callbackIndex];
        input[callbackIndex] = (error, result) => {
          if (error) return callback(error, result);
          let replaced;
          try {
            replaced = replace(result);
          } catch (failure) {
            return callback(failure);
          }
          return callback(null, replaced);
        };
        return query.apply(this, input);
      }
      const pending = query.apply(this, input);
      if (!pending || typeof pending.then !== 'function')
        throw new Error('Exact clock SELECT requires promise or callback query API');
      return pending.then(replace);
    });
    return {
      restore,
      get instant() {
        return new Date(instant);
      },
      get day() {
        return time.businessDate(instant);
      },
      advanceFloor(value) {
        if (restored) throw new Error('Clock is restored');
        const floor = new Date(value);
        if (
          !Number.isFinite(floor.getTime()) ||
          floor.toISOString() !== value ||
          time.businessDate(floor) !== time.businessDate(instant)
        )
          throw new Error('Logical clock floor must stay inside the current declared business day');
        if (floor > instant) instant = floor;
      },
      setDay(day) {
        if (restored) throw new Error('Clock is restored');
        const parsed = new Date(`${day}T00:00:00Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          day < FIRST_DAY ||
          day > LAST_DAY ||
          !Number.isFinite(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== day
        )
          throw new Error('Logical day must stay inside the declared six-month window');
        instant = new Date(`${day}T08:00:00+08:00`);
      },
      tick() {
        if (restored) throw new Error('Clock is restored');
        const next = new Date(instant.getTime() + 1000);
        if (time.businessDate(next) !== time.businessDate(instant))
          throw new Error('Too many seed actions in one logical day');
        instant = next;
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}
