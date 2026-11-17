import { localMnPhone } from '@tugeel/shared/phone';

// The pure rules of «Байгууллага» → «Манайхан», without the phone.

/** «8938 3719» of a stored `+97689383719`; another number as it stands. */
export function phoneLabel(stored: string): string {
  const local = localMnPhone(stored);
  return /^\d{8}$/.test(local) ? `${local.slice(0, 4)} ${local.slice(4)}` : local;
}

/** What stands under a colleague's name: the position, then the division. */
export function roleLine(person: { position: string | null; divisionName: string | null }): string {
  return [person.position, person.divisionName]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join(' · ');
}

/** The `mailto:` of an address, or null without one. */
export function mailUriOf(email: string | null): string | null {
  const address = email?.trim() ?? '';
  return address.includes('@') ? `mailto:${address}` : null;
}
