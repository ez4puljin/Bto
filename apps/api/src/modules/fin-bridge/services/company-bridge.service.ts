import { Injectable } from '@nestjs/common';
import { cleanTaxNumber, isTinFor, normalizeRegNo, regNoShape } from '@tugeel/shared/taxpayer';
import { invalid } from '../../../common/errors/app-error';
import { type FinCompanyView, FinOrgService } from '../../../finance-core';
import type { Actor, AuthContext } from '../../identity';
import { FinContexts } from './contexts.service';

export interface CompanyEdit {
  legalName: string;
  registerNo: string | null;
  tin: string | null;
}

const blankToNull = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value;

/**
 * The installation's company on «Компани» (ADR-0070 #2, ADR-0084): every staff member reads it
 * (print headers carry its name), and a user with `finance.settings.manage` there edits its legal
 * identity. The Mongolian shapes are checked here (`@tugeel/shared/taxpayer`, ADR-0074); the core
 * checks only generic ones.
 */
@Injectable()
export class FinCompanyBridge {
  constructor(
    private readonly contexts: FinContexts,
    private readonly org: FinOrgService,
  ) {}

  async get(actor: Actor): Promise<FinCompanyView> {
    return this.org.company(this.contexts.forSource(actor), {
      company: await this.contexts.companyCode(),
    });
  }

  async update(ctx: AuthContext, edit: CompanyEdit): Promise<FinCompanyView> {
    const rawRegisterNo = blankToNull(edit.registerNo);
    const registerNo = rawRegisterNo === null ? null : normalizeRegNo(rawRegisterNo);
    if (registerNo !== null && regNoShape(registerNo) !== 'COMPANY') {
      throw invalid('registerNo', 'companyRegNo', 'a company register number has 7 digits');
    }
    const rawTin = blankToNull(edit.tin);
    const tin = rawTin === null ? null : cleanTaxNumber(rawTin);
    if (tin !== null && !isTinFor('COMPANY', tin)) {
      throw invalid('tin', 'companyTin', 'a company TIN has 11 digits');
    }
    return this.org.updateCompany(this.contexts.forUser(ctx), {
      company: await this.contexts.companyCode(),
      legalName: edit.legalName,
      registerNo,
      tin,
    });
  }
}
