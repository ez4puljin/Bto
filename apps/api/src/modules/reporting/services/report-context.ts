import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type AuthContext, SettingsService } from '../../identity';

/** What every report needs to know about its caller and the installation. */
export interface ReportScope {
  today: string;
  /** The Finance Core company of this installation (`bto.company_code`, ADR-0084). */
  company: string;
  /** Margins under this percent are flagged (`reports.margin_threshold_pct`, ADR-0108 #3). */
  threshold: Decimal;
  /** The caller holds `reports.margins.view`: costs, profit, margins and stock values. */
  margins: boolean;
}

@Injectable()
export class ReportContext {
  constructor(private readonly settings: SettingsService) {}

  async scope(ctx: AuthContext, today: string = businessDate()): Promise<ReportScope> {
    const [company, threshold] = await Promise.all([
      this.settings.get('bto.company_code', today),
      this.settings.get('reports.margin_threshold_pct', today),
    ]);
    return {
      today,
      company,
      threshold: new Decimal(threshold),
      margins: ctx.permissions.has('reports.margins.view'),
    };
  }
}
