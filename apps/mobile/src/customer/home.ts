// «Холбоо барих» of «Bto300» (ADR-0079 #14, on «Профайл» since ADR-0092 #8) as pure functions: the
// contacts' avatars and the phones as the app shows them; and products in a notice's order.

/**
 * A contact's avatar: the first letters of the role's first two words («Захиалга, оффис» → «ЗО»,
 * «Нягтлан бодогч, тооцоо» → «НБ»); punctuation is not a word.
 */
export function contactInitialsOf(role: string): string {
  return role
    .split(/[\s,.;:()/\\«»"'–—-]+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
}

/** The contact people the app lists, in the admin's order. */
export function shownContacts<T extends { shown: boolean }>(contacts: readonly T[]): T[] {
  return contacts.filter((contact) => contact.shown);
}

/** «+976 9911 2233»: a stored Mongolian number as the app shows it; anything else as it is. */
export function phoneShown(phone: string): string {
  const match = /^\+976(\d{4})(\d{4})$/.exec(phone.replace(/\s/g, ''));
  return match ? `+976 ${match[1]} ${match[2]}` : phone;
}

/** Products in the given order of ids; an id the server did not return is left out. */
export function inOrderOf<T extends { id: number }>(
  ids: readonly number[],
  products: readonly T[],
): T[] {
  const found = new Map(products.map((product) => [product.id, product]));
  return ids.flatMap((id) => {
    const product = found.get(id);
    return product ? [product] : [];
  });
}
