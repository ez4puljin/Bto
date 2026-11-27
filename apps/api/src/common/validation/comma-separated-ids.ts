import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Legacy comma-separated query ids: an empty string means none; malformed ids are never dropped. */
export function commaSeparatedIds(value: unknown, maxItems = 100): number[] | null {
  if (typeof value !== 'string') return null;
  if (value === '') return [];
  // A safe integer has at most 16 decimal digits. Bound work before splitting an arbitrary input.
  if (value.length > maxItems * 17 - 1) return null;
  const parts = value.split(',');
  if (parts.length > maxItems) return null;
  const ids: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,16}$/.test(part)) return null;
    const id = Number(part);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    ids.push(id);
  }
  return ids;
}

export function IsCommaSeparatedIds(
  maxItems = 100,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, property) => {
    registerDecorator({
      name: 'isCommaSeparatedIds',
      target: target.constructor,
      propertyName: String(property),
      options,
      validator: {
        validate: (value: unknown) => commaSeparatedIds(value, maxItems) !== null,
        defaultMessage: () =>
          `$property must contain at most ${maxItems} comma-separated positive safe integer ids`,
      },
    });
  };
}
