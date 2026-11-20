import { Injectable } from '@nestjs/common';
import { isEmployeeLeft } from '@tugeel/shared/hr';
import { WorkforceService } from '../../hr';

/** An employee as payroll sees them: the card's names and dates, and whether attendance is tracked. */
export interface PayrollPerson {
  userId: number;
  fullName: string;
  position: string | null;
  divisionId: number | null;
  divisionName: string | null;
  status: 'ACTIVE' | 'DISABLED';
  employedOn: string | null;
  leftOn: string | null;
  left: boolean;
  tracked: boolean;
}

/**
 * The staff list from hr (one record per person, ADR-0145), read through hr's own services:
 * payroll keeps no copy of a name or a division beyond a payslip's snapshot.
 */
@Injectable()
export class PayrollPeopleService {
  constructor(private readonly workforce: WorkforceService) {}

  async all(): Promise<PayrollPerson[]> {
    const cards = await this.workforce.employees();
    return cards.map((card) => ({
      userId: card.userId,
      fullName: card.fullName,
      position: card.position,
      divisionId: card.divisionId,
      divisionName: card.divisionName,
      status: card.status,
      employedOn: card.employedOn,
      leftOn: card.leftOn,
      left: isEmployeeLeft(card),
      tracked: card.tracked,
    }));
  }

  async byId(): Promise<Map<number, PayrollPerson>> {
    return new Map((await this.all()).map((person) => [person.userId, person]));
  }
}

/**
 * Who belongs on a month's run: employed at some point of it. One who left inside the month stays;
 * one who left before it, or whose account is closed without a date, does not (as the time report).
 */
export function employedIn(person: PayrollPerson, from: string, to: string): boolean {
  if (person.employedOn !== null && person.employedOn > to) return false;
  if (person.leftOn !== null) return person.leftOn >= from;
  return person.status === 'ACTIVE';
}
