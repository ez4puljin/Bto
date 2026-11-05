import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Takes a row of a `SearchSelect` or `Combobox`: a click opens it, the row sits in a portal. */
export async function choose(user: UserEvent, field: HTMLElement, name: string | RegExp) {
  await user.click(field);
  await user.click(await screen.findByRole('option', { name }));
}
