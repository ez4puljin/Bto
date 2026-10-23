import { Injectable } from '@nestjs/common';
import {
  type FinPeriodEventView,
  FinPeriodsService,
  type FinPeriodView,
} from '../../../finance-core';
import type { AuthContext } from '../../identity';
import { FinBooks } from './fin-books';

/**
 * «Сарын хаалт» (ADR-0102 #1–#3): the company's months, their closes and reopens, through the
 * Finance Core as the signed-in staff member (`finance.periods.close` / `.reopen` per company).
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly books: FinBooks,
    private readonly periods: FinPeriodsService,
  ) {}

  async list(ctx: AuthContext): Promise<FinPeriodView[]> {
    return this.periods.periods(this.books.user(ctx), { company: await this.books.company() });
  }

  async events(ctx: AuthContext, period?: string): Promise<FinPeriodEventView[]> {
    return this.periods.events(this.books.user(ctx), {
      company: await this.books.company(),
      ...(period === undefined ? {} : { period }),
    });
  }

  async close(ctx: AuthContext, period: string): Promise<FinPeriodView> {
    return this.periods.close(this.books.user(ctx), {
      company: await this.books.company(),
      period,
    });
  }

  async reopen(ctx: AuthContext, period: string, reason: string): Promise<FinPeriodView> {
    return this.periods.reopen(this.books.user(ctx), {
      company: await this.books.company(),
      period,
      reason,
    });
  }
}
