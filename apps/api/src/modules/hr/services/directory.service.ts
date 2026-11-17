import { Inject, Injectable } from '@nestjs/common';
import { isEmployeeLeft } from '@tugeel/shared/hr';
import { localMnPhone } from '@tugeel/shared/phone';
import { matchesQuery, matchesStrictly, queryTerms, searchKeys } from '@tugeel/shared/text';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { StorageService } from '../../identity';
import { hrDivisions } from '../schema';
import { HrSettingsService } from './hr-settings.service';

/** One colleague as «Манайхан» shows them: how to find and reach them, nothing private. */
export interface DirectoryEntry {
  userId: number;
  /** «Г. Энхтуяа»: the family name's initial and the given name; the account's name without a card. */
  displayName: string;
  fullName: string;
  position: string | null;
  divisionName: string | null;
  /** The sign-in phone as stored (E.164). */
  phone: string | null;
  /** Not kept on the card yet: always null until it is. */
  email: string | null;
  photoUrl: string | null;
}

/** «Г. Энхтуяа» of the card's names; the account's full name when the card has none. */
export function directoryName(person: {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
}): string {
  const first = person.firstName?.trim() ?? '';
  const initial = [...(person.lastName?.trim() ?? '')][0]?.toUpperCase() ?? '';
  if (first === '') return person.fullName;
  return initial === '' ? first : `${initial}. ${first}`;
}

/**
 * The company's people for every signed-in staff member (the staff app's «Байгууллага» →
 * «Манайхан»): the employed ones only (`isEmployeeLeft`), with their name, position, division,
 * phone and card photo. Birth dates, addresses, pay and the rest of the card stay with HR. The
 * search follows the shared search keys (`@tugeel/shared/text`) over the name, position, division,
 * phone and email; the list is the size of the staff, so it is read whole and filtered here.
 */
@Injectable()
export class DirectoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: HrSettingsService,
    private readonly storage: StorageService,
  ) {}

  async list(q = ''): Promise<DirectoryEntry[]> {
    const [people, divisions] = await Promise.all([
      this.settings.employees(),
      this.db.select({ id: hrDivisions.id, name: hrDivisions.name }).from(hrDivisions),
    ]);
    const employed = people.filter((person) => !isEmployeeLeft(person));
    const photos = await this.storage.publicUrls(
      employed.flatMap((person) => (person.photoFileId === null ? [] : [person.photoFileId])),
    );
    const divisionName = new Map(divisions.map((row) => [row.id, row.name]));
    const entries = employed.map((person) => ({
      sortName: person.firstName ?? person.fullName,
      entry: {
        userId: person.userId,
        displayName: directoryName(person),
        fullName: person.fullName,
        position: person.position,
        divisionName:
          person.divisionId === null ? null : (divisionName.get(person.divisionId) ?? null),
        phone: person.phone,
        email: null,
        photoUrl: person.photoFileId === null ? null : (photos.get(person.photoFileId) ?? null),
      } satisfies DirectoryEntry,
    }));
    const terms = queryTerms(q);
    const found =
      terms.length === 0
        ? entries.map((row) => ({ ...row, strict: true }))
        : entries.flatMap((row) => {
            const { entry } = row;
            const keys = searchKeys(entry.displayName, [
              entry.fullName,
              entry.position ?? '',
              entry.divisionName ?? '',
              entry.phone === null ? '' : localMnPhone(entry.phone),
              entry.email ?? '',
            ]);
            return matchesQuery(keys, terms)
              ? [{ ...row, strict: matchesStrictly(keys, terms) }]
              : [];
          });
    return found
      .sort(
        (a, b) =>
          (b.strict ? 1 : 0) - (a.strict ? 1 : 0) ||
          a.sortName.localeCompare(b.sortName, 'mn') ||
          a.entry.userId - b.entry.userId,
      )
      .map(({ entry }) => entry);
  }
}
