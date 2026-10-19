import {
  CODE_PATTERN,
  type FinActor,
  FinActorSchema,
  type FinPermission,
  isFinPermission,
} from '@tugeel/fin-contract';
import { FinError } from '../errors';

/**
 * Who calls the core (ADR-0076 #2). A SOURCE is a source system acting under its grant (Bto's sale,
 * the PMS's outbox); a USER is a person of the core's own screens, authorised per company. Both name
 * their tenant: the core resolves every company inside it.
 */
export type FinPrincipal =
  | { readonly kind: 'SOURCE'; readonly tenant: string; readonly system: string }
  | { readonly kind: 'USER'; readonly tenant: string; readonly ref: string };

declare const FIN_CALL_CONTEXT_BRAND: unique symbol;

/**
 * The only way into the core's ports. Branded: the type cannot be written by hand, and the core
 * refuses at run time any object `createFinCallContext` did not issue (a spread copy included).
 */
export interface FinCallContext {
  readonly principal: FinPrincipal;
  /** USER: the finance rights per company code; SOURCE: empty (the grants decide). */
  readonly permissions: ReadonlyMap<string, ReadonlySet<FinPermission>>;
  /** Attribution only, never authorisation (ADR-0071 #7). */
  readonly actor: Readonly<FinActor>;
  readonly requestId: string | null;
  readonly [FIN_CALL_CONTEXT_BRAND]: true;
}

export interface FinCallContextInput {
  principal: FinPrincipal;
  /** Company code → finance rights; codes that are not finance rights are dropped. */
  permissions?: Readonly<Record<string, readonly string[]>>;
  actor: FinActor;
  requestId?: string | null;
}

const ISSUED = new WeakSet<object>();

function invalid(path: string): FinError {
  return new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
}

function code(value: string, path: string): string {
  if (!CODE_PATTERN.test(value)) throw invalid(path);
  return value;
}

/**
 * Builds a context. ESLint lets only `modules/fin-bridge` (and the test StaticCaller) call it
 * (§3.1 rule 8): a source system never hands the core a principal it chose itself.
 */
export function createFinCallContext(input: FinCallContextInput): FinCallContext {
  const tenant = code(input.principal.tenant, 'principal.tenant');
  const principal: FinPrincipal =
    input.principal.kind === 'SOURCE'
      ? Object.freeze({
          kind: 'SOURCE',
          tenant,
          system: code(input.principal.system, 'principal.system'),
        })
      : Object.freeze({ kind: 'USER', tenant, ref: code(input.principal.ref, 'principal.ref') });
  const actor = FinActorSchema.safeParse(input.actor);
  if (!actor.success) throw invalid('actor');
  const permissions = new Map<string, ReadonlySet<FinPermission>>();
  for (const [company, codes] of Object.entries(input.permissions ?? {})) {
    permissions.set(code(company, 'permissions'), new Set(codes.filter(isFinPermission)));
  }
  const context = Object.freeze({
    principal,
    permissions,
    actor: Object.freeze({ ...actor.data }),
    requestId: input.requestId ?? null,
  }) as unknown as FinCallContext;
  ISSUED.add(context);
  return context;
}

/** Throws unless `value` was issued by `createFinCallContext` in this process. */
export function assertFinCallContext(value: unknown): asserts value is FinCallContext {
  if (typeof value !== 'object' || value === null || !ISSUED.has(value)) {
    throw new Error('The Finance Core accepts only a FinCallContext from createFinCallContext');
  }
}

/** `SOURCE:<system>` or `USER:<ref>`: how the audit trail names the principal. */
export function principalLabel(principal: FinPrincipal): string {
  return principal.kind === 'SOURCE' ? `SOURCE:${principal.system}` : `USER:${principal.ref}`;
}
