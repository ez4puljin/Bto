import {
  AUTH_COOKIE,
  GRAPHQL_PATH,
  LOGIN_DOCUMENT,
  pathsOfField,
  type QueryShape,
  renderQuery,
  withoutField,
} from './erxes-wire';

/** `fetch` as the erxes client uses it; tests give a scripted one, never the network. */
export const ERXES_FETCH = Symbol('ERXES_FETCH');
export type ErxesFetch = (url: string, init: RequestInit) => Promise<Response>;

export const ERXES_ERROR_REASONS = [
  'LOGIN_FAILED',
  'UNREACHABLE',
  'TIMEOUT',
  'UNEXPECTED_ANSWER',
] as const;
export type ErxesErrorReason = (typeof ERXES_ERROR_REASONS)[number];

/** What went wrong between Bto and erxes. The message never holds the password or the token. */
export class ErxesError extends Error {
  constructor(
    readonly reason: ErxesErrorReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ErxesError';
  }
}

export interface ErxesAccount {
  /** `https://host`, no path. */
  baseUrl: string;
  email: string;
  password: string;
}

export const ERXES_TIMEOUT_MS = 30_000;
/** How many refused fields one query may lose before the answer is called unexpected. */
const MAX_CUTS = 40;

interface GraphqlError {
  message?: unknown;
  locations?: unknown;
  extensions?: unknown;
}

interface Answer {
  status: number;
  data: Record<string, unknown> | null;
  errors: GraphqlError[];
  token: string | null;
}

const messageOf = (error: GraphqlError): string =>
  typeof error.message === 'string' ? error.message : '';

/** «Cannot query field "x" on type "T"», or the gateway's «no field `x` in type `T`». */
const UNKNOWN_FIELD = [
  /Cannot query field ["“`]?([A-Za-z0-9_]+)["”`]? on type ["“`]?([A-Za-z0-9_]+)/,
  /[Nn]o field ["“`]?([A-Za-z0-9_]+)["”`]? (?:in|on) type ["“`]?([A-Za-z0-9_]+)/,
];

function unknownField(error: GraphqlError): RegExpExecArray | null {
  for (const pattern of UNKNOWN_FIELD) {
    const found = pattern.exec(messageOf(error));
    if (found) return found;
  }
  return null;
}

function needsSignIn(errors: readonly GraphqlError[], status: number): boolean {
  if (status === 401) return true;
  return errors.some((error) => {
    const code =
      typeof error.extensions === 'object' && error.extensions !== null
        ? (error.extensions as { code?: unknown }).code
        : undefined;
    return code === 'UNAUTHENTICATED' || /login required|not authenticated/i.test(messageOf(error));
  });
}

/** The line (1-based) an error points at, when erxes says. */
function lineOf(error: GraphqlError): number | null {
  const first: unknown = Array.isArray(error.locations) ? error.locations[0] : null;
  const line =
    typeof first === 'object' && first !== null ? (first as { line?: unknown }).line : null;
  return typeof line === 'number' ? line : null;
}

/**
 * erxes's GraphQL over plain `fetch` (ADR-0218 #2, #8). It signs in with the `login` mutation,
 * keeps the session token for its lifetime and after that sends queries only: `read` builds every
 * document itself with the word `query`, so nothing here can change anything in erxes.
 *
 * A field erxes does not know is cut from the query and the query sent again (introspection is
 * off there, so the field lists are best knowledge); `cuts` says what was cut.
 */
export class ErxesClient {
  private readonly endpoint: string;
  private token: string | null;
  /** Fields erxes refused, as `root.path.to.field`. */
  readonly cuts: string[] = [];
  /** A shape as erxes took it after its refused fields were cut, for the next query of it. */
  private readonly learned = new Map<QueryShape, QueryShape>();

  constructor(
    private readonly account: ErxesAccount,
    private readonly fetchFn: ErxesFetch,
    token: string | null = null,
    private readonly timeoutMs: number = ERXES_TIMEOUT_MS,
  ) {
    let url: URL;
    try {
      url = new URL(account.baseUrl);
    } catch {
      throw new ErxesError('UNREACHABLE', 'the address is not a URL');
    }
    // The password goes only to an encrypted address.
    if (url.protocol !== 'https:') throw new ErxesError('UNREACHABLE', 'the address is not https');
    this.endpoint = `${url.origin}${GRAPHQL_PATH}`;
    this.token = token;
  }

  /** The session token to keep for the next client; null before a sign-in. */
  get session(): string | null {
    return this.token;
  }

  /** Signs in; throws `LOGIN_FAILED` when erxes does not take the email and the password. */
  async signIn(): Promise<void> {
    this.token = null;
    const answer = await this.post(LOGIN_DOCUMENT, {
      email: this.account.email,
      password: this.account.password,
    });
    const said = answer.data?.login;
    // erxes answers «loggedIn» and sets the cookie; some versions answer the token itself.
    const token =
      answer.token ?? (typeof said === 'string' && said.length > 40 ? said : null) ?? null;
    if (answer.errors.length > 0 || !said || token === null) {
      throw new ErxesError('LOGIN_FAILED', 'erxes did not accept the sign-in', answer.status);
    }
    this.token = token;
  }

  /**
   * The answer of the first shape erxes takes. A refused field is cut and the query sent again;
   * a shape erxes refuses otherwise (an unknown root, a missing argument) moves on to the next
   * one; an expired session signs in once more. When every shape is refused the error says what
   * erxes said of each, so the failure is seen and never read as an empty answer (ADR-0220).
   */
  async read(shapes: readonly QueryShape[], variables: Record<string, unknown> = {}) {
    const refusals: string[] = [];
    let status: number | undefined;
    for (const shape of shapes) {
      try {
        return await this.readShape(this.learned.get(shape) ?? shape, variables, shape);
      } catch (error: unknown) {
        if (error instanceof UnknownRoot) {
          refusals.push(`erxes does not know «${shape.root}»`);
        } else if (error instanceof ErxesError && error.reason === 'UNEXPECTED_ANSWER') {
          refusals.push(error.message);
          status = error.status ?? status;
        } else {
          throw error;
        }
      }
    }
    throw new ErxesError(
      'UNEXPECTED_ANSWER',
      refusals.length > 0 ? refusals.join(' | ') : 'no query to send',
      status,
    );
  }

  private async readShape(
    start: QueryShape,
    variables: Record<string, unknown>,
    asked: QueryShape,
  ): Promise<unknown> {
    let shape = start;
    let signedInAgain = false;
    for (let attempt = 0; attempt <= MAX_CUTS; attempt += 1) {
      if (this.token === null) await this.signIn();
      const { document, paths } = renderQuery(shape);
      const answer = await this.post(document, variables);
      if (answer.errors.length === 0) {
        if (!answer.data || !(shape.root in answer.data)) {
          throw new ErxesError('UNEXPECTED_ANSWER', `no «${shape.root}» in the answer`);
        }
        // The next query of this shape goes without the fields erxes refused.
        if (shape !== asked) this.learned.set(asked, shape);
        return answer.data[shape.root];
      }
      if (needsSignIn(answer.errors, answer.status)) {
        if (signedInAgain) throw new ErxesError('LOGIN_FAILED', 'erxes keeps asking to sign in');
        signedInAgain = true;
        this.token = null;
        continue;
      }
      const refused: string[][] = [];
      for (const error of answer.errors) {
        const unknown = unknownField(error);
        if (!unknown?.[1]) continue;
        if (unknown[1] === shape.root && unknown[2] === 'Query') throw new UnknownRoot();
        const line = lineOf(error);
        const path = line === null ? null : (paths[line - 1] ?? null);
        if (path && path[path.length - 1] === unknown[1]) refused.push(path);
        else refused.push(...pathsOfField(shape.selection, unknown[1]));
      }
      if (refused.length === 0) {
        throw new ErxesError(
          'UNEXPECTED_ANSWER',
          `erxes refused «${shape.root}»: ${answer.errors.map(messageOf).join('; ').slice(0, 300)}`,
          answer.status,
        );
      }
      let selection: QueryShape['selection'] | null = shape.selection;
      for (const path of refused) {
        this.cuts.push(`${shape.root}.${path.join('.')}`);
        selection = selection ? withoutField(selection, path) : null;
      }
      if (!selection) {
        throw new ErxesError('UNEXPECTED_ANSWER', `erxes knows no field of «${shape.root}»`);
      }
      shape = { ...shape, selection };
    }
    throw new ErxesError('UNEXPECTED_ANSWER', `too many refused fields in «${shape.root}»`);
  }

  private async post(document: string, variables: Record<string, unknown>): Promise<Answer> {
    let response: Response;
    let body: unknown;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.token ? { cookie: `${AUTH_COOKIE}=${this.token}` } : {}),
        },
        body: JSON.stringify({ query: document, variables }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        throw new ErxesError(
          'UNEXPECTED_ANSWER',
          `erxes answered HTTP ${response.status} without JSON`,
          response.status,
        );
      }
    } catch (error: unknown) {
      if (error instanceof ErxesError) throw error;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ErxesError('TIMEOUT', `erxes did not answer in ${this.timeoutMs} ms`);
      }
      throw new ErxesError('UNREACHABLE', 'erxes could not be reached');
    }
    const json = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const data =
      typeof json.data === 'object' && json.data !== null
        ? (json.data as Record<string, unknown>)
        : null;
    const errors = Array.isArray(json.errors) ? (json.errors as GraphqlError[]) : [];
    if (data === null && errors.length === 0) {
      throw new ErxesError(
        'UNEXPECTED_ANSWER',
        `erxes answered HTTP ${response.status} without data`,
        response.status,
      );
    }
    return { status: response.status, data, errors, token: cookieOf(response) };
  }
}

/** erxes does not know a query's root field: the next shape is tried. */
class UnknownRoot extends Error {}

function cookieOf(response: Response): string | null {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const at = pair?.indexOf('=') ?? -1;
    if (pair && at > 0 && pair.slice(0, at).trim() === AUTH_COOKIE) {
      const value = pair.slice(at + 1).trim();
      if (value !== '') return value;
    }
  }
  return null;
}
