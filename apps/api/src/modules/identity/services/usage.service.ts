import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { type UsageApp, type UsageEvent, usageEventsToSend } from '@tugeel/shared/usage';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { screenUsage, screenUsageSeen } from '../schema';

/** Whose minute this was: a staff member, or a store's account in «Bto300». */
export type UsageActor = { kind: 'staff' | 'customer'; id: number };

export interface ScreenUsageRow {
  app: UsageApp;
  screen: string;
  opens: number;
  seconds: number;
  /** How many different people opened it in the period (the day-marks, while they are kept). */
  people: number;
}

const actorKey = (actor: UsageActor): string =>
  `${actor.kind === 'staff' ? 's' : 'c'}${Math.trunc(actor.id)}`;

/**
 * Which screens are used (ADR-0197). The write is one statement for the counts and one for the
 * day-marks, both of them upserts: a client that sends the same minute twice adds its figures
 * twice, which is the price of never answering an app's send with anything but 204.
 */
@Injectable()
export class UsageService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Adds what one client gathered. Returns how many screens were counted. */
  async record(actor: UsageActor, app: UsageApp, events: readonly UsageEvent[]): Promise<number> {
    const sending = usageEventsToSend(events);
    if (sending.length === 0) return 0;
    const day = businessDate();
    await this.db
      .insert(screenUsage)
      .values(sending.map((event) => ({ day, app, ...event })))
      .onConflictDoUpdate({
        target: [screenUsage.day, screenUsage.app, screenUsage.screen],
        set: {
          opens: sql`${screenUsage.opens} + excluded.opens`,
          seconds: sql`${screenUsage.seconds} + excluded.seconds`,
        },
      });
    await this.db
      .insert(screenUsageSeen)
      .values(sending.map((event) => ({ day, app, screen: event.screen, actor: actorKey(actor) })))
      .onConflictDoNothing();
    return sending.length;
  }

  /** The screens used between two days, the busiest first. */
  async summary(from: string, to: string): Promise<ScreenUsageRow[]> {
    // The marks are counted on their own and joined: a person is one however many days they came.
    const result = await this.db.execute<{
      app: string;
      screen: string;
      opens: number;
      seconds: number;
      people: number;
    }>(sql`
      SELECT u.app, u.screen, u.opens::int, u.seconds::int, coalesce(p.people, 0)::int AS people
      FROM (
        SELECT app, screen, sum(opens) AS opens, sum(seconds) AS seconds
        FROM ${screenUsage}
        WHERE day BETWEEN ${from} AND ${to}
        GROUP BY app, screen
      ) u
      LEFT JOIN (
        SELECT app, screen, count(DISTINCT actor) AS people
        FROM ${screenUsageSeen}
        WHERE day BETWEEN ${from} AND ${to}
        GROUP BY app, screen
      ) p USING (app, screen)
      ORDER BY u.opens DESC, u.app, u.screen
    `);
    const rows = result.rows;
    return rows.map((row) => ({
      app: row.app as UsageApp,
      screen: row.screen,
      opens: row.opens,
      seconds: row.seconds,
      people: row.people,
    }));
  }
}
