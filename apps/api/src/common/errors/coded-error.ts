/** Values the client interpolates into its Mongolian message for `code`. */
export type ProblemParams = Record<string, string | number | boolean | null>;

export interface FieldError {
  path: string;
  constraint: string;
  message: string;
}

/** HTTP status per stable code of one catalog; a code without a status fails typecheck. */
export type ErrorStatusTable<C extends string> = Readonly<Record<C, number>>;

const OWNERS = new Map<string, string>();

/**
 * The code-agnostic error-status registry (ADR-0069 #7): every catalog owner (Bto, the Finance
 * Core) registers its table once, at load. A code two owners register throws, so two catalogs in
 * one process never give one code two meanings.
 */
export function registerErrorStatuses<C extends string>(
  owner: string,
  table: ErrorStatusTable<C>,
): ErrorStatusTable<C> {
  for (const code of Object.keys(table)) {
    const registered = OWNERS.get(code);
    if (registered !== undefined && registered !== owner) {
      throw new Error(`error code ${code} is registered by ${registered} and ${owner}`);
    }
    OWNERS.set(code, owner);
  }
  return table;
}

/** Who registered `code`, if anyone. */
export function errorCodeOwner(code: string): string | undefined {
  return OWNERS.get(code);
}

/**
 * An expected failure with a stable code (RFC 9457, ADR-0004). Each owner subclasses it with its own
 * code type and status table (Bto's `AppError`, the core's `FinError`); `detail` is English for
 * logs, the client shows Mongolian text chosen by `code` (ADR-0011).
 */
export class CodedError<C extends string = string> extends Error {
  constructor(
    readonly code: C,
    readonly status: number,
    readonly detail?: string,
    readonly params?: ProblemParams,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? code);
    this.name = 'CodedError';
  }
}

/** Any owner's coded error (`instanceof` alone would narrow to `CodedError<any>`). */
export function isCodedError(value: unknown): value is CodedError {
  return value instanceof CodedError;
}
