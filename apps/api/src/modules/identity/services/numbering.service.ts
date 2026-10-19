import { Injectable } from '@nestjs/common';
import { type CounterTable, nextCounterValue } from '../../../common/db/counters';
import type { Tx } from '../../../common/db/db.types';
import { numberSequences } from '../schema';

const NUMBER_SEQUENCES: CounterTable<typeof numberSequences> = {
  table: numberSequences,
  key: [numberSequences.scopeKey, numberSequences.period],
  value: numberSequences.lastValue,
  valueProperty: 'lastValue',
};

/**
 * Gap-free document numbers (ADR-0002 #7, SPEC §6.13). Call inside the posting transaction under
 * READ COMMITTED (the default of `inTransaction`): the upsert locks the (scope, period) row until
 * commit, so concurrent callers queue and a rollback gives its number back.
 */
@Injectable()
export class NumberingService {
  /** The next value for `scopeKey` (e.g. `GR`, `BILLID:<posNo>`) in `period` (e.g. `2026`). */
  next(tx: Tx, scopeKey: string, period: string): Promise<number> {
    return nextCounterValue(tx, NUMBER_SEQUENCES, { scopeKey, period });
  }
}
