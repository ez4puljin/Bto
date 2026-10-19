/**
 * The test StaticCaller (`apps/api/test/harness/static-caller.ts`) builds contexts without any Bto
 * module and marks the process when it is loaded. A production process with that mark refuses to
 * start (ADR-0076 #2, ADR-0084 #4): test principals never reach real books.
 */
export const STATIC_CALLER_MARK: unique symbol = Symbol.for('tugeel.fin.static-caller') as never;

export function assertNoStaticCaller(env: string | undefined = process.env['NODE_ENV']): void {
  const marked = (globalThis as Record<symbol, unknown>)[STATIC_CALLER_MARK] === true;
  if (env === 'production' && marked) {
    throw new Error('The Finance Core test StaticCaller is loaded in a production process');
  }
}
