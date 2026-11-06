import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { EmployeeGender, ScheduleDay } from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { and, isNull, sql } from 'drizzle-orm';
import { DbModule } from '../../../common/db/db.module';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { CoreModule } from '../../../core.module';
import { IdentityModule, systemActor } from '../../identity';
import { HrModule } from '../hr.module';
import { hrWorkSites } from '../schema';
import { type ImportedEmployee, WorkforceService } from '../services/workforce.service';

@Module({ imports: [CoreModule.forRoot('api'), DbModule, IdentityModule, HrModule] })
class ImportTimelyModule {}

type EmployeeRecord = [
  number,
  string,
  string,
  string,
  string | null,
  string | null,
  string,
  string | null,
  string | null,
  string | null,
  string,
];
type ScheduleRecord = [
  string,
  string,
  string,
  string | null,
  [number, string, string, string | null, string | null, string | null, string | null, number][],
  number[],
];

interface Export {
  divisions: string[];
  location: { name: string; lat: number; lng: number; radius: number } | null;
  employees: EmployeeRecord[];
  schedules: ScheduleRecord[];
}

const GENDERS: Record<string, EmployeeGender> = { male: 'MALE', female: 'FEMALE' };

/**
 * `pnpm hr:import-timely -- --file tmp/timely/export.json --photos tmp/timely/photos` (ADR-0144):
 * the employees read from timely.mn by the owner's request — staff users signing in by phone,
 * their cards, divisions and photos — with timely's schedules and its location as a work site.
 * The first password comes from `HR_IMPORT_PASSWORD` (never an argument, never printed). Run with
 * the database migrated; idempotent (by timely's id, else by phone).
 */
async function main(): Promise<void> {
  // pnpm 11 passes the `--` through; paths are the caller's (INIT_CWD), not apps/api.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { file: { type: 'string' }, photos: { type: 'string' } },
  });
  const base = process.env.INIT_CWD ?? process.cwd();
  if (!values.file) throw new Error('--file is required');
  const data = JSON.parse(readFileSync(resolve(base, values.file), 'utf8')) as Export;
  const password = process.env.HR_IMPORT_PASSWORD?.trim() || null;
  const photosDir = values.photos ? resolve(base, values.photos) : null;
  const app = await NestFactory.createApplicationContext(ImportTimelyModule, {
    logger: ['error'],
  });
  try {
    const actor = systemActor('cli:hr-import-timely');
    const workforce = app.get(WorkforceService);
    const records: ImportedEmployee[] = data.employees.map((row) => {
      const [id, firstName, lastName, phone, division, position, , employedOn, gender] = row;
      const photoPath = photosDir ? join(photosDir, `${id}.jpg`) : null;
      return {
        externalRef: `timely:${id}`,
        firstName,
        lastName,
        phone,
        position,
        division,
        employmentType: 'PERMANENT',
        gender: gender ? (GENDERS[gender] ?? null) : null,
        employedOn: employedOn ?? null,
        password,
        photo:
          photoPath && existsSync(photoPath)
            ? { contentType: 'image/jpeg', bytes: readFileSync(photoPath) }
            : null,
      };
    });
    await workforce.importDivisions(data.divisions);
    const people = await workforce.importEmployees(actor, records);
    console.log(
      `Employees: ${people.created} created, ${people.updated} updated, ${people.photos} photo(s).`,
    );
    let schedules = 0;
    for (const [name, type, , , days, timelyIds] of data.schedules) {
      const userIds = timelyIds.flatMap((id) => {
        const userId = people.userIds.get(`timely:${id}`);
        return userId === undefined ? [] : [userId];
      });
      const scheduleDays: ScheduleDay[] = days.map(
        ([weekday, start, end, , , breakStart, breakEnd, hours]) => ({
          weekday,
          start,
          end,
          breakStart,
          breakEnd,
          minutes: hours * 60,
        }),
      );
      await workforce.importSchedule(actor, {
        name,
        kind: type === 'flex' ? 'FLEXIBLE' : 'FIXED',
        days: scheduleDays,
        userIds,
      });
      schedules += 1;
    }
    const tidied = await workforce.tidyImportedSchedules(actor);
    console.log(
      `Schedules: ${schedules}${tidied ? `, ${tidied} repeated copy(ies) archived` : ''}.`,
    );
    if (data.location) {
      const db = app.get<Db>(DB);
      const [site] = await db
        .select({ id: hrWorkSites.id })
        .from(hrWorkSites)
        .where(
          and(
            sql`lower(${hrWorkSites.name}) = lower(${data.location.name})`,
            isNull(hrWorkSites.archivedAt),
          ),
        );
      if (!site) {
        await db.insert(hrWorkSites).values({
          name: data.location.name,
          lat: new Decimal(data.location.lat).toDecimalPlaces(6),
          lng: new Decimal(data.location.lng).toDecimalPlaces(6),
          // Bto's smallest radius is 30 m (ADR-0131); timely's was smaller.
          radiusM: Math.max(30, Math.round(data.location.radius)),
        });
        console.log(`Work site «${data.location.name}» added.`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
