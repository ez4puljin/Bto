import { parse } from 'libpg-query';
import { AI_DATASET_NAMES } from '../semantic/datasets';

/**
 * The SQL guard of the AI assistant (ADR-0045 #3). A model-written query passes only when the
 * PostgreSQL 18 parser (libpg-query) sees exactly one SELECT whose every parse-tree node is of an
 * allowed type, whose relations are the `ai` views (or CTEs in scope), and whose functions, casts
 * and operators are on allow-lists. Refusals carry an English detail the model can repair from.
 * The guard is the second of five barriers: the read-only role and transaction stand behind it.
 */

export const SQL_MAX_LENGTH = 8_000;
const MAX_NODES = 5_000;
const MAX_DEPTH = 200;
const MAX_CONCATENATIONS = 30;
const MAX_COLUMNS = 60;

export const GUARD_REASONS = [
  'EMPTY',
  'TOO_LONG',
  'SYNTAX',
  'NOT_ONE_STATEMENT',
  'NOT_SELECT',
  'CONSTRUCT',
  'RELATION',
  'FUNCTION',
  'OPERATOR',
  'TYPE',
  'TOO_COMPLEX',
] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];

export type GuardResult =
  { ok: true; sql: string } | { ok: false; reason: GuardReason; detail: string };

/** Parse-tree node types a SELECT over the views may contain. */
const NODES = new Set([
  'SelectStmt',
  'ResTarget',
  'ColumnRef',
  'A_Star',
  'A_Const',
  'String',
  'Integer',
  'Float',
  'Boolean',
  'A_Expr',
  'BoolExpr',
  'NullTest',
  'BooleanTest',
  'CaseExpr',
  'CaseWhen',
  'CoalesceExpr',
  'MinMaxExpr',
  'SubLink',
  'RangeVar',
  'RangeSubselect',
  'JoinExpr',
  'TypeCast',
  'FuncCall',
  'SortBy',
  'WindowDef',
  'GroupingSet',
  'GroupingFunc',
  'RowExpr',
  'SQLValueFunction',
  'CollateClause',
  'List',
]);

/** Readable names for the refusals the model is most likely to meet. */
const CONSTRUCT_NAMES: Record<string, string> = {
  ParamRef: 'parameters ($1)',
  RangeFunction: 'functions in FROM (generate_series, ROWS FROM, …)',
  RangeTableSample: 'TABLESAMPLE',
  RangeTableFunc: 'XMLTABLE',
  JsonTable: 'JSON_TABLE',
  A_ArrayExpr: 'ARRAY[…]',
  A_Indirection: 'subscripts and field selection',
  XmlExpr: 'XML functions',
  XmlSerialize: 'XMLSERIALIZE',
  LockingClause: 'FOR UPDATE / FOR SHARE',
  NamedArgExpr: 'named arguments',
};

const SUBLINKS = new Set([
  'EXISTS_SUBLINK',
  'ALL_SUBLINK',
  'ANY_SUBLINK',
  'ROWCOMPARE_SUBLINK',
  'EXPR_SUBLINK',
]);

const EXPRESSION_KINDS = new Set([
  'AEXPR_OP',
  'AEXPR_OP_ANY',
  'AEXPR_OP_ALL',
  'AEXPR_DISTINCT',
  'AEXPR_NOT_DISTINCT',
  'AEXPR_NULLIF',
  'AEXPR_IN',
  'AEXPR_LIKE',
  'AEXPR_ILIKE',
  'AEXPR_BETWEEN',
  'AEXPR_NOT_BETWEEN',
  'AEXPR_BETWEEN_SYM',
  'AEXPR_NOT_BETWEEN_SYM',
]);
const BETWEEN_KINDS = new Set([
  'AEXPR_BETWEEN',
  'AEXPR_NOT_BETWEEN',
  'AEXPR_BETWEEN_SYM',
  'AEXPR_NOT_BETWEEN_SYM',
]);
/** Comparison, arithmetic, concatenation and LIKE / ILIKE; no regular expressions or `^`. */
const OPERATORS = new Set([
  '=',
  '<>',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  '~~',
  '!~~',
  '~~*',
  '!~~*',
]);

const DATE_TIME_VALUES = new Set([
  'SVFOP_CURRENT_DATE',
  'SVFOP_CURRENT_TIME',
  'SVFOP_CURRENT_TIME_N',
  'SVFOP_CURRENT_TIMESTAMP',
  'SVFOP_CURRENT_TIMESTAMP_N',
  'SVFOP_LOCALTIME',
  'SVFOP_LOCALTIME_N',
  'SVFOP_LOCALTIMESTAMP',
  'SVFOP_LOCALTIMESTAMP_N',
]);

/**
 * Built-in functions a report needs. Not here on purpose: anything that builds large values
 * (string_agg, array and JSON aggregates, repeat, lpad, rpad, replace, format, overlay),
 * generates rows (generate_series), reads settings or the server (current_setting, set_config,
 * pg_*, lo_*, query_to_xml) or waits (pg_sleep).
 */
export const ALLOWED_FUNCTIONS = new Set([
  // aggregates
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'bool_and',
  'bool_or',
  'every',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'corr',
  // window functions
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  // numbers
  'round',
  'trunc',
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'sign',
  'mod',
  'div',
  'sqrt',
  'ln',
  'log',
  'exp',
  // text
  'lower',
  'upper',
  'initcap',
  'length',
  'char_length',
  'character_length',
  'substring',
  'substr',
  'left',
  'right',
  'btrim',
  'ltrim',
  'rtrim',
  'position',
  'strpos',
  'split_part',
  'concat',
  'concat_ws',
  'reverse',
  'translate',
  'starts_with',
  // formatting
  'to_char',
  'to_number',
  'to_date',
  'to_timestamp',
  // dates and times
  'now',
  'date_trunc',
  'date_part',
  'extract',
  'age',
  'make_date',
  'date_bin',
  'timezone',
  'clock_timestamp',
  'statement_timestamp',
  'transaction_timestamp',
  'justify_days',
  'justify_hours',
  'justify_interval',
  'isfinite',
]);

/** Cast targets, as the parser names them (INTEGER is pg_catalog.int4, …). */
const TYPES = new Set([
  'text',
  'varchar',
  'bpchar',
  'char',
  'numeric',
  'decimal',
  'int2',
  'int4',
  'int8',
  'int',
  'integer',
  'smallint',
  'bigint',
  'float4',
  'float8',
  'real',
  'bool',
  'boolean',
  'date',
  'timestamp',
  'timestamptz',
  'time',
  'timetz',
  'interval',
]);

type Body = Record<string, unknown>;
type Scope = ReadonlySet<string>;

class Refusal extends Error {
  constructor(
    readonly reason: GuardReason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** The body of `{ <type>: body }`, or null when the node is of another type. */
function unwrap(node: unknown, type: string): Body | null {
  if (node === null || typeof node !== 'object') return null;
  const body = (node as Body)[type];
  return body !== null && typeof body === 'object' ? (body as Body) : null;
}

/** The text of a list of String nodes (function, operator and type names). */
function names(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const value = unwrap(item, 'String')?.sval;
    return typeof value === 'string' ? value : '';
  });
}

/** A name, optionally qualified with pg_catalog (SQL syntax such as EXTRACT is), else null. */
function catalogName(parts: readonly string[]): string | null {
  if (parts.length === 1) return parts[0] ?? null;
  if (parts.length === 2 && parts[0] === 'pg_catalog') return parts[1] ?? null;
  return null;
}

/** Walks the parse tree once; the first refusal ends the walk. */
class TreeCheck {
  private nodes = 0;
  private concatenations = 0;

  select(body: Body, scope: Scope, depth: number): void {
    this.count(depth);
    if (body.intoClause) throw new Refusal('CONSTRUCT', 'SELECT INTO is not allowed');
    if (body.lockingClause) {
      throw new Refusal('CONSTRUCT', 'FOR UPDATE / FOR SHARE is not allowed');
    }
    if (Array.isArray(body.targetList) && body.targetList.length > MAX_COLUMNS) {
      throw new Refusal('TOO_COMPLEX', `select at most ${MAX_COLUMNS} columns`);
    }
    const inner = this.withClause(body.withClause, scope, depth);
    for (const [key, field] of Object.entries(body)) {
      if (key === 'withClause') continue;
      // The branches of UNION / INTERSECT / EXCEPT are SelectStmt bodies without a wrapper.
      if (key === 'larg' || key === 'rarg') this.select(field as Body, inner, depth + 1);
      else this.visit(field, inner, depth + 1);
    }
  }

  /** CTEs see the ones before them (never themselves): WITH RECURSIVE is refused. */
  private withClause(clause: unknown, scope: Scope, depth: number): Scope {
    if (clause === undefined) return scope;
    const body = clause as Body;
    if (body.recursive) throw new Refusal('CONSTRUCT', 'WITH RECURSIVE is not allowed');
    let inner = new Set(scope);
    for (const item of Array.isArray(body.ctes) ? body.ctes : []) {
      const cte = unwrap(item, 'CommonTableExpr');
      if (!cte) throw new Refusal('CONSTRUCT', 'unexpected WITH item');
      this.count(depth + 1);
      if (cte.search_clause || cte.cycle_clause) {
        throw new Refusal('CONSTRUCT', 'SEARCH and CYCLE clauses are not allowed');
      }
      const query = unwrap(cte.ctequery, 'SelectStmt');
      if (!query) throw new Refusal('NOT_SELECT', 'every WITH query must be a SELECT');
      this.select(query, inner, depth + 2);
      inner = new Set([...inner, String(cte.ctename)]);
    }
    return inner;
  }

  private visit(value: unknown, scope: Scope, depth: number): void {
    if (depth > MAX_DEPTH) throw new Refusal('TOO_COMPLEX', 'the query is nested too deeply');
    if (Array.isArray(value)) {
      for (const item of value) this.visit(item, scope, depth + 1);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const entries = Object.entries(value as Body);
    const [first] = entries;
    // A node is { NodeType: body }; message fields (alias, typeName, over, …) are plain bodies.
    if (entries.length === 1 && first && /^[A-Z]/.test(first[0])) {
      this.node(first[0], first[1] as Body, scope, depth + 1);
      return;
    }
    for (const [, field] of entries) this.visit(field, scope, depth + 1);
  }

  private node(type: string, body: Body, scope: Scope, depth: number): void {
    if (type === 'SelectStmt') {
      this.select(body, scope, depth);
      return;
    }
    this.count(depth);
    if (!NODES.has(type)) {
      throw new Refusal('CONSTRUCT', `${CONSTRUCT_NAMES[type] ?? type} is not allowed`);
    }
    switch (type) {
      case 'RangeVar':
        this.relation(body, scope);
        return;
      case 'FuncCall':
        this.func(body);
        break;
      case 'A_Expr':
        this.expression(body);
        break;
      case 'TypeCast':
        this.type(body.typeName);
        break;
      case 'SubLink':
        if (!SUBLINKS.has(String(body.subLinkType))) {
          throw new Refusal('CONSTRUCT', 'ARRAY(subquery) is not allowed');
        }
        // `x <op> ANY (subquery)` names its operator here, not in an A_Expr.
        if (body.operName !== undefined) this.operator(names(body.operName));
        break;
      case 'SortBy':
        if (body.useOp !== undefined) {
          throw new Refusal('OPERATOR', 'ORDER BY … USING is not allowed; use ASC or DESC');
        }
        break;
      case 'SQLValueFunction':
        if (!DATE_TIME_VALUES.has(String(body.op))) {
          throw new Refusal('FUNCTION', 'only date and time values such as current_date');
        }
        break;
    }
    for (const field of Object.values(body)) this.visit(field, scope, depth + 1);
  }

  private relation(body: Body, scope: Scope): void {
    const name = typeof body.relname === 'string' ? body.relname : '';
    const schema = typeof body.schemaname === 'string' ? body.schemaname : undefined;
    if (body.catalogname) throw new Refusal('RELATION', `"${name}": no database names`);
    if (schema === undefined && scope.has(name)) return;
    if ((schema === undefined || schema === 'ai') && AI_DATASET_NAMES.has(name)) return;
    const qualified = schema ? `${schema}.${name}` : name;
    throw new Refusal(
      'RELATION',
      `relation "${qualified}" is not available; use only the datasets ${[...AI_DATASET_NAMES].join(', ')}`,
    );
  }

  private func(body: Body): void {
    const parts = names(body.funcname);
    const name = catalogName(parts)?.toLowerCase();
    if (!name || !ALLOWED_FUNCTIONS.has(name)) {
      throw new Refusal('FUNCTION', `function "${parts.join('.')}" is not allowed`);
    }
  }

  private expression(body: Body): void {
    const kind = String(body.kind);
    if (!EXPRESSION_KINDS.has(kind)) {
      throw new Refusal(
        'OPERATOR',
        `${kind === 'AEXPR_SIMILAR' ? 'SIMILAR TO' : kind} is not allowed`,
      );
    }
    if (BETWEEN_KINDS.has(kind)) return;
    this.operator(names(body.name));
  }

  /** One unqualified operator from OPERATORS; concatenations are counted. */
  private operator(parts: readonly string[]): void {
    const operator = parts.length === 1 ? parts[0] : undefined;
    if (!operator || !OPERATORS.has(operator)) {
      throw new Refusal('OPERATOR', `operator "${parts.join('.')}" is not allowed`);
    }
    if (operator === '||') {
      this.concatenations += 1;
      if (this.concatenations > MAX_CONCATENATIONS) {
        throw new Refusal('TOO_COMPLEX', `use at most ${MAX_CONCATENATIONS} || operators`);
      }
    }
  }

  private type(typeName: unknown): void {
    const body = (typeName ?? {}) as Body;
    const parts = names(body.names);
    const name = catalogName(parts)?.toLowerCase();
    const array = Array.isArray(body.arrayBounds) && body.arrayBounds.length > 0;
    if (!name || !TYPES.has(name) || array || body.setof || body.pct_type) {
      throw new Refusal('TYPE', `cast to "${parts.join('.')}${array ? '[]' : ''}" is not allowed`);
    }
  }

  private count(depth: number): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw new Refusal('TOO_COMPLEX', 'the query is too large');
    if (depth > MAX_DEPTH) throw new Refusal('TOO_COMPLEX', 'the query is nested too deeply');
  }
}

/** Checks one model-written query; on success returns its text without a trailing semicolon. */
export async function guardSql(input: string): Promise<GuardResult> {
  const sql = input.trim();
  if (!sql) return { ok: false, reason: 'EMPTY', detail: 'the query is empty' };
  if (sql.length > SQL_MAX_LENGTH) {
    return {
      ok: false,
      reason: 'TOO_LONG',
      detail: `keep the query under ${SQL_MAX_LENGTH} characters`,
    };
  }
  let statements;
  try {
    statements = (await parse(sql)).stmts ?? [];
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'syntax error';
    return { ok: false, reason: 'SYNTAX', detail };
  }
  const [raw, ...more] = statements;
  if (!raw || more.length > 0) {
    return { ok: false, reason: 'NOT_ONE_STATEMENT', detail: 'send exactly one statement' };
  }
  const select = unwrap(raw.stmt, 'SelectStmt');
  if (!select) return { ok: false, reason: 'NOT_SELECT', detail: 'only a SELECT is allowed' };
  try {
    new TreeCheck().select(select, new Set(), 0);
  } catch (error: unknown) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason, detail: error.detail };
    throw error;
  }
  return { ok: true, sql: statementText(sql, raw.stmt_location, raw.stmt_len) };
}

/** The statement's own text: the parser counts UTF-8 bytes, and 0 / absent means "to the end". */
function statementText(sql: string, location = 0, length = 0): string {
  const bytes = Buffer.from(sql, 'utf8');
  const end = length > 0 ? location + length : bytes.length;
  return bytes.subarray(location, end).toString('utf8').trim();
}

/** The cursor the reader runs: exactly one DECLARE over exactly one SELECT, checked again. */
export async function cursorStatement(sql: string, portal: string): Promise<string> {
  const text = `DECLARE ${portal} NO SCROLL CURSOR FOR\n${sql}\n`;
  const statements = (await parse(text)).stmts ?? [];
  const declare = statements.length === 1 ? unwrap(statements[0]?.stmt, 'DeclareCursorStmt') : null;
  if (!declare || declare.portalname !== portal || !unwrap(declare.query, 'SelectStmt')) {
    throw new Error('the cursor statement did not parse as one DECLARE over one SELECT');
  }
  return text;
}
