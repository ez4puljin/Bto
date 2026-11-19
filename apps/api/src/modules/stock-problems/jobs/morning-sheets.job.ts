import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { StockProblemSheetsService } from '../services/stock-problem-sheets.service';

/**
 * stockproblems.morningSheets, every morning at 07:00 Ulaanbaatar time (ADR-0230 #6, ADR-0040):
 * the day's sheet of every warehouse that has problem products, with the system's quantities at
 * that moment. Building twice changes nothing, so a retry or a manager's button the same morning
 * is safe.
 */
@Injectable()
export class MorningSheetsJob implements JobHandler<'stockproblems.morningSheets'> {
  readonly name = 'stockproblems.morningSheets' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '0 7 * * *';

  constructor(private readonly sheets: StockProblemSheetsService) {}

  async handle(): Promise<{ sheets: number }> {
    return { sheets: (await this.sheets.build(null)).length };
  }
}
