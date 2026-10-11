/** A LIKE pattern fragment with %, _ and \ taken literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
