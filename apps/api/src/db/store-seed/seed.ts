import { type Client, escapeIdentifier } from 'pg';
import {
  type SeedClass,
  type SeedRule,
  STORE_SEED_SKIPPED_SCHEMAS,
  STORE_SEED_STATE_TABLES,
  STORE_SEED_TABLES,
} from './manifest';

/**
 * The store seed (ADR-0186 #5): copies master data, and only master data, from a source database
 * into a freshly migrated target that nobody has started yet. It reads the source in one read-only
 * snapshot and writes the target in one transaction, as the role that owns the tables (migrator):
 * plain INSERTs in foreign-key order, so every guard trigger and constraint of the target stays in
 * force. It never deletes from a table that holds documents, never disables a trigger and never
 * prints a row.
 */

export interface SeedColumn {
  name: string;
  /** `format_type` of the column: the cast that turns its text form back into a value. */
  type: string;
  sequence: string | null;
}

export interface SeedTable {
  key: string;
  schema: string;
  name: string;
  /** Writable columns, in table order (generated columns are computed by the target). */
  columns: SeedColumn[];
  primaryKey: string[];
  /** A guard trigger forbids UPDATE and DELETE on it. */
  appendOnly: boolean;
}

export interface SeedForeignKey {
  child: string;
  parent: string;
  columns: string[];
  parentColumns: string[];
}

export interface PlannedTable {
  key: string;
  class: SeedClass;
  note: string | null;
  /** Rows of the source table. */
  sourceRows: number;
  /** Rows the seed writes (0 unless copied; fewer than `sourceRows` for `onlyReferenced`). */
  copyRows: number;
  /** Rows the target holds before the seed. */
  targetRows: number;
}

export interface SeedPlan {
  tables: PlannedTable[];
  /** Copied tables, parents before children. */
  order: string[];
  /** Anything here stops the seed. */
  problems: string[];
  warnings: string[];
}

export interface SeedResult {
  plan: SeedPlan;
  copied: { key: string; inserted: number; updated: number; deleted: number }[];
  sequences: number;
}

const TIMESTAMPS = new Set(['created_at', 'updated_at']);
const CHUNK_ROWS = 5000;

const q = (key: string): string => key.split('.').map(escapeIdentifier).join('.');

async function prepareSession(client: Client): Promise<void> {
  // The text form of every value must mean the same on both sides.
  await client.query(`SET TIME ZONE 'UTC'`);
  await client.query(`SET datestyle = 'ISO, YMD'`);
  await client.query(`SET intervalstyle = 'postgres'`);
  await client.query(`SET bytea_output = 'hex'`);
  await client.query(`SET extra_float_digits = 1`);
}

async function readTables(client: Client): Promise<Map<string, SeedTable>> {
  const skipped = [...STORE_SEED_SKIPPED_SCHEMAS];
  const { rows } = await client.query<{
    key: string;
    schema: string;
    name: string;
    column: string;
    type: string;
    generated: boolean;
    sequence: string | null;
    append_only: boolean;
  }>(
    `SELECT n.nspname || '.' || c.relname AS key, n.nspname AS schema, c.relname AS name,
            a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
            a.attgenerated <> '' AS generated,
            pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS sequence,
            EXISTS (
              SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
              WHERE g.tgrelid = c.oid AND NOT g.tgisinternal AND p.proname = 'forbid_update_delete'
                AND (g.tgtype & 1) = 1
            ) AS append_only
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
       AND n.nspname <> ALL ($1::text[])
     ORDER BY 1, a.attnum`,
    [skipped],
  );
  const tables = new Map<string, SeedTable>();
  for (const row of rows) {
    let table = tables.get(row.key);
    if (!table) {
      table = {
        key: row.key,
        schema: row.schema,
        name: row.name,
        columns: [],
        primaryKey: [],
        appendOnly: row.append_only,
      };
      tables.set(row.key, table);
    }
    if (!row.generated) {
      table.columns.push({ name: row.column, type: row.type, sequence: row.sequence });
    }
  }
  const keys = await client.query<{ key: string; column: string }>(
    `SELECT n.nspname || '.' || c.relname AS key, a.attname AS column
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
     WHERE i.indisprimary
     ORDER BY 1, array_position(i.indkey::int2[], a.attnum)`,
  );
  for (const row of keys.rows) tables.get(row.key)?.primaryKey.push(row.column);
  return tables;
}

async function readForeignKeys(client: Client): Promise<SeedForeignKey[]> {
  const { rows } = await client.query<{
    child: string;
    parent: string;
    columns: string[];
    parent_columns: string[];
  }>(
    `SELECT cn.nspname || '.' || cc.relname AS child, pn.nspname || '.' || pc.relname AS parent,
            ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) AS columns,
            ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
                  ORDER BY k.ord) AS parent_columns
     FROM pg_constraint con
     JOIN pg_class cc ON cc.oid = con.conrelid
     JOIN pg_namespace cn ON cn.oid = cc.relnamespace
     JOIN pg_class pc ON pc.oid = con.confrelid
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f' AND NOT cc.relispartition
     ORDER BY 1, con.conname`,
  );
  return rows.map((row) => ({
    child: row.child,
    parent: row.parent,
    columns: row.columns,
    parentColumns: row.parent_columns,
  }));
}

async function countRows(client: Client, key: string, where = ''): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${q(key)} ${where}`,
  );
  return Number.parseInt(rows[0]?.n ?? '0', 10);
}

/** Applied migrations as `<journal time>:<hash of the SQL text>`, in journal order. */
async function migrationsOf(client: Client): Promise<string[] | null> {
  const { rows: exists } = await client.query<{ ok: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`,
  );
  if (!exists[0]?.ok) return null;
  const { rows } = await client.query<{ id: string }>(
    `SELECT created_at::text || ':' || hash AS id FROM drizzle.__drizzle_migrations ORDER BY created_at, hash`,
  );
  return rows.map((row) => row.id);
}

const migrationTime = (id: string): string => id.slice(0, id.indexOf(':'));

const ruleOf = (key: string): SeedRule =>
  STORE_SEED_TABLES[key] ?? {
    class: 'undecided',
    note: 'not listed in apps/api/src/db/store-seed/manifest.ts',
  };

/** Columns of a foreign key that the rule overwrites with NULL: that reference never travels. */
const cutByRule = (rule: SeedRule, fk: SeedForeignKey): boolean =>
  fk.columns.some((column) => rule.set && column in rule.set && rule.set[column] === null);

/** A reference written in the second step: it does not decide the order of the tables. */
const writtenLate = (rule: SeedRule, fk: SeedForeignKey): boolean =>
  fk.columns.some((column) => rule.late?.includes(column));

/** The rows of an `onlyReferenced` table that copied tables point at. */
function referencedFilter(table: SeedTable, fks: SeedForeignKey[]): string {
  const [pk] = table.primaryKey;
  const selects = fks
    .filter(
      (fk) =>
        fk.parent === table.key &&
        fk.child !== table.key &&
        ruleOf(fk.child).class === 'copy' &&
        !cutByRule(ruleOf(fk.child), fk),
    )
    .map((fk) => {
      const column = escapeIdentifier(fk.columns[0] ?? '');
      return `SELECT ${column} FROM ${q(fk.child)} WHERE ${column} IS NOT NULL`;
    });
  if (!pk || !selects.length) return 'WHERE false';
  return `WHERE ${escapeIdentifier(pk)} IN (${selects.join(' UNION ')})`;
}

function sourceFilter(table: SeedTable, fks: SeedForeignKey[]): string {
  return ruleOf(table.key).onlyReferenced ? referencedFilter(table, fks) : '';
}

/** Parents before children among the copied tables; what is left over sits on a cycle. */
function copyOrder(copied: string[], fks: SeedForeignKey[]): { order: string[]; cyclic: string[] } {
  const inSet = new Set(copied);
  const parents = new Map<string, Set<string>>(copied.map((key) => [key, new Set<string>()]));
  for (const fk of fks) {
    if (fk.child === fk.parent || !inSet.has(fk.child) || !inSet.has(fk.parent)) continue;
    if (cutByRule(ruleOf(fk.child), fk) || writtenLate(ruleOf(fk.child), fk)) continue;
    parents.get(fk.child)?.add(fk.parent);
  }
  const order: string[] = [];
  const left = new Set(copied);
  for (;;) {
    const ready = [...left].filter((key) =>
      [...(parents.get(key) ?? [])].every((parent) => !left.has(parent)),
    );
    if (!ready.length) break;
    for (const key of ready.sort()) {
      order.push(key);
      left.delete(key);
    }
  }
  return { order, cyclic: [...left].sort() };
}

/**
 * Reads both databases and says what the seed would do. Nothing is written. A plan with problems
 * is never run.
 */
export async function planStoreSeed(source: Client, target: Client): Promise<SeedPlan> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const [sourceTables, targetTables, fks, sourceMigrations, targetMigrations] = [
    await readTables(source),
    await readTables(target),
    await readForeignKeys(source),
    await migrationsOf(source),
    await migrationsOf(target),
  ];

  if (!sourceMigrations || !targetMigrations) {
    problems.push('both databases must be migrated (drizzle.__drizzle_migrations is missing)');
  } else if (
    sourceMigrations.map(migrationTime).join() !== targetMigrations.map(migrationTime).join()
  ) {
    problems.push(
      `the two databases are on different migrations (source ${sourceMigrations.length}, target ${targetMigrations.length}): migrate both from the same commit`,
    );
  } else {
    const edited = sourceMigrations.filter((id, i) => id !== targetMigrations[i]).length;
    if (edited) {
      warnings.push(
        `${edited} migrations reached the source from a text that differs from the target's (same migration, another wording); the columns of every copied table are compared as well`,
      );
    }
  }
  for (const key of Object.keys(STORE_SEED_TABLES)) {
    if (!sourceTables.has(key))
      warnings.push(`${key} is listed in the manifest but does not exist`);
  }

  const tables: PlannedTable[] = [];
  const copied: string[] = [];
  for (const table of [...sourceTables.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const rule = ruleOf(table.key);
    const twin = targetTables.get(table.key);
    if (!twin) {
      problems.push(`${table.key} is missing in the target`);
      continue;
    }
    const sourceRows = await countRows(source, table.key);
    const targetRows = await countRows(target, table.key);
    let copyRows = 0;
    if (rule.class === 'copy') {
      copied.push(table.key);
      const shape = (t: SeedTable): string => t.columns.map((c) => `${c.name}:${c.type}`).join();
      if (shape(table) !== shape(twin)) problems.push(`${table.key}: the columns differ`);
      if (rule.onlyReferenced && table.primaryKey.length !== 1) {
        problems.push(`${table.key}: onlyReferenced needs a single-column primary key`);
      }
      for (const column of Object.keys(rule.set ?? {})) {
        if (!table.columns.some((c) => c.name === column)) {
          problems.push(`${table.key}: the manifest sets a column that does not exist: ${column}`);
        }
      }
      if (targetRows > 0 && !rule.seeded) {
        problems.push(
          `the target is not empty: ${table.key} holds ${targetRows} rows (the seed fills only a database that was migrated and never started)`,
        );
      }
      if ((rule.seeded || rule.late) && !table.primaryKey.length) {
        problems.push(`${table.key}: a seeded table or one with late columns needs a primary key`);
      }
      if (rule.appendByContent) {
        const names = [rule.appendByContent.identity, ...rule.appendByContent.latestOf];
        if (names.some((name) => !table.columns.some((c) => c.name === name))) {
          problems.push(`${table.key}: appendByContent names a column that does not exist`);
        }
        const pointing = fks.filter(
          (fk) => fk.parent === table.key && ruleOf(fk.child).class === 'copy',
        );
        if (pointing.length) {
          problems.push(
            `${table.key}: its ids are new in the target, but ${pointing[0]?.child} is copied and points at it`,
          );
        }
      }
      if (rule.late && (rule.seeded || twin.appendOnly)) {
        problems.push(`${table.key}: late columns need a plain table the migrations leave empty`);
      }
      for (const column of rule.late ?? []) {
        if (!table.columns.some((c) => c.name === column)) {
          problems.push(
            `${table.key}: the manifest names a late column that does not exist: ${column}`,
          );
        }
      }
      copyRows = rule.onlyReferenced
        ? await countRows(source, table.key, sourceFilter(table, fks))
        : sourceRows;
    } else if (
      targetRows > 0 &&
      !(STORE_SEED_STATE_TABLES as readonly string[]).includes(table.key)
    ) {
      problems.push(
        `the target is not empty: ${table.key} holds ${targetRows} rows (the seed fills only a database that was migrated and never started)`,
      );
    }
    tables.push({
      key: table.key,
      class: rule.class,
      note: rule.note ?? null,
      sourceRows,
      copyRows,
      targetRows,
    });
  }
  for (const key of targetTables.keys()) {
    if (!sourceTables.has(key)) problems.push(`${key} is missing in the source`);
  }

  // A copied row may point only at copied rows.
  for (const fk of fks) {
    const childRule = ruleOf(fk.child);
    if (childRule.class !== 'copy' || !sourceTables.has(fk.child)) continue;
    if (cutByRule(childRule, fk)) continue;
    const parentRule = ruleOf(fk.parent);
    if (parentRule.class === 'copy') {
      if (parentRule.onlyReferenced && fk.columns.length !== 1) {
        problems.push(`${fk.child} -> ${fk.parent}: onlyReferenced needs single-column keys`);
      }
      continue;
    }
    const notNull = fk.columns.map((c) => `${escapeIdentifier(c)} IS NOT NULL`).join(' AND ');
    const pointing = await countRows(source, fk.child, `WHERE ${notNull}`);
    if (pointing > 0) {
      problems.push(
        `${fk.child}.${fk.columns.join('+')} points at ${fk.parent}, which is not copied (${pointing} rows): list the column under "set" or copy the parent`,
      );
    }
  }

  const { order, cyclic } = copyOrder(copied, fks);
  if (cyclic.length) {
    problems.push(`copied tables reference each other in a circle: ${cyclic.join(', ')}`);
  }
  return { tables, order, problems, warnings };
}

type Row = (string | null)[];

async function readRows(client: Client, table: SeedTable, where: string): Promise<Row[]> {
  const columns = table.columns.map((c) => `${escapeIdentifier(c.name)}::text`).join(', ');
  const orderBy = table.primaryKey.length
    ? `ORDER BY ${table.primaryKey.map(escapeIdentifier).join(', ')}`
    : '';
  const { rows } = await client.query<Row>({
    text: `SELECT ${columns} FROM ${q(table.key)} ${where} ${orderBy}`,
    rowMode: 'array',
  });
  return rows;
}

function applySet(table: SeedTable, rule: SeedRule, rows: Row[]): void {
  if (!rule.set) return;
  for (const [column, value] of Object.entries(rule.set)) {
    const index = table.columns.findIndex((c) => c.name === column);
    for (const row of rows) row[index] = value;
  }
}

/** One late column of one table: the keys of the rows and the values they get in the second step. */
interface LateWrite {
  table: SeedTable;
  column: SeedColumn;
  keys: Row[];
  values: string[];
}

/** Takes the late columns' values out of the rows (NULL goes in first) and remembers them. */
function takeLate(table: SeedTable, rule: SeedRule, rows: Row[]): LateWrite[] {
  const pkIndex = table.primaryKey.map((name) => table.columns.findIndex((c) => c.name === name));
  const writes: LateWrite[] = [];
  for (const name of rule.late ?? []) {
    const index = table.columns.findIndex((c) => c.name === name);
    const column = table.columns[index];
    if (!column) continue;
    const write: LateWrite = { table, column, keys: [], values: [] };
    for (const row of rows) {
      const value = row[index];
      if (value === null || value === undefined) continue;
      write.keys.push(pkIndex.map((i) => row[i] ?? null));
      write.values.push(value);
      row[index] = null;
    }
    writes.push(write);
  }
  return writes;
}

async function writeLate(target: Client, write: LateWrite): Promise<void> {
  if (!write.values.length) return;
  const { table, column } = write;
  const pk = table.columns.filter((c) => table.primaryKey.includes(c.name));
  const pkOrder = table.primaryKey.map((name) => pk.findIndex((c) => c.name === name));
  const params = [...pk.map((_, i) => `$${i + 1}::text[]`), `$${pk.length + 1}::text[]`].join(', ');
  const aliases = [...pk.map((_, i) => `k${i}`), 'v'].join(', ');
  const match = table.primaryKey
    .map(
      (name, i) => `t.${escapeIdentifier(name)} = u.k${i}::${pk[pkOrder[i] ?? 0]?.type ?? 'text'}`,
    )
    .join(' AND ');
  const { rowCount } = await target.query(
    `UPDATE ${q(table.key)} AS t SET ${escapeIdentifier(column.name)} = u.v::${column.type}
     FROM unnest(${params}) AS u(${aliases}) WHERE ${match}`,
    [...table.primaryKey.map((_, i) => write.keys.map((key) => key[i] ?? null)), write.values],
  );
  if (rowCount !== write.values.length) {
    throw new Error(
      `${table.key}.${column.name}: ${rowCount} of ${write.values.length} late values written`,
    );
  }
}

/** One INSERT for all the rows; `without` names a generated key the target fills itself. */
async function insertRows(
  target: Client,
  table: SeedTable,
  rows: Row[],
  without?: string,
): Promise<void> {
  if (!rows.length) return;
  const columns = table.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.name !== without);
  const names = columns.map(({ column }) => escapeIdentifier(column.name)).join(', ');
  const casts = columns.map(({ column }, i) => `u.v${i}::${column.type}`).join(', ');
  const params = columns.map((_, i) => `$${i + 1}::text[]`).join(', ');
  const aliases = columns.map((_, i) => `v${i}`).join(', ');
  await target.query(
    `INSERT INTO ${q(table.key)} (${names}) ${without ? '' : 'OVERRIDING SYSTEM VALUE'}
     SELECT ${casts} FROM unnest(${params}) WITH ORDINALITY AS u(${aliases}, ord) ORDER BY u.ord`,
    columns.map(({ index }) => rows.map((row) => row[index] ?? null)),
  );
}

/**
 * An append-only table the migrations seed (the posting rules): nothing in it can be changed or
 * removed, and nothing has to be. What the source says and the target lacks is appended.
 */
async function appendByContent(
  target: Client,
  table: SeedTable,
  rows: Row[],
  existing: Row[],
  options: { identity: string; latestOf: string[] },
): Promise<number> {
  const idIndex = table.columns.findIndex((c) => c.name === options.identity);
  const said = table.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.name !== options.identity && !TIMESTAMPS.has(column.name));
  const contentOf = (row: Row): string => JSON.stringify(said.map(({ index }) => row[index]));
  const tally = (list: Row[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of list) counts.set(contentOf(row), (counts.get(contentOf(row)) ?? 0) + 1);
    return counts;
  };
  const wanted = tally(rows);
  const held = tally(existing);
  for (const [content, count] of held) {
    if ((wanted.get(content) ?? 0) < count) {
      throw new Error(
        `${table.key}: the target holds a migration row the source lacks, and the table is append-only`,
      );
    }
  }
  const fresh: Row[] = [];
  for (const row of rows) {
    const content = contentOf(row);
    const left = held.get(content) ?? 0;
    if (left > 0) held.set(content, left - 1);
    else fresh.push(row);
  }
  await insertRows(target, table, fresh, options.identity);

  // The row in force (the highest id of its group) must say the same on both sides.
  const groupIndex = options.latestOf.map((name) =>
    table.columns.findIndex((c) => c.name === name),
  );
  const inForce = (list: Row[]): Map<string, string> => {
    const latest = new Map<string, { id: bigint; content: string }>();
    for (const row of list) {
      const group = JSON.stringify(groupIndex.map((i) => row[i]));
      const id = BigInt(row[idIndex] ?? '0');
      const seen = latest.get(group);
      if (!seen || id > seen.id) latest.set(group, { id, content: contentOf(row) });
    }
    return new Map([...latest].map(([group, value]) => [group, value.content]));
  };
  const before = inForce(rows);
  const after = inForce(await readRows(target, table, ''));
  for (const [group, content] of before) {
    if (after.get(group) !== content) {
      throw new Error(`${table.key}: the row in force differs after the copy for ${group}`);
    }
  }
  return fresh.length;
}

async function copyTable(
  source: Client,
  target: Client,
  table: SeedTable,
  fks: SeedForeignKey[],
): Promise<{ inserted: number; updated: number; deleted: number; late: LateWrite[] }> {
  const rule = ruleOf(table.key);
  const rows = await readRows(source, table, sourceFilter(table, fks));
  applySet(table, rule, rows);
  const late = takeLate(table, rule, rows);
  const existing = rule.seeded ? await readRows(target, table, '') : [];
  if (!existing.length) {
    // A row may point at a later row of its own table: one statement checks them together.
    const selfReferencing = fks.some((fk) => fk.child === table.key && fk.parent === table.key);
    const step = selfReferencing ? Math.max(rows.length, 1) : CHUNK_ROWS;
    for (let at = 0; at < rows.length; at += step) {
      await insertRows(target, table, rows.slice(at, at + step));
    }
    return { inserted: rows.length, updated: 0, deleted: 0, late };
  }

  if (rule.appendByContent) {
    const inserted = await appendByContent(target, table, rows, existing, rule.appendByContent);
    return { inserted, updated: 0, deleted: 0, late };
  }

  // The migrations wrote rows here: make the target's rows the source's, by primary key.
  const pkIndex = table.primaryKey.map((name) => table.columns.findIndex((c) => c.name === name));
  const keyOf = (row: Row): string => JSON.stringify(pkIndex.map((i) => row[i]));
  const wanted = new Map(rows.map((row) => [keyOf(row), row]));
  const pkWhere = table.primaryKey
    .map((name, i) => {
      const column = table.columns[pkIndex[i] ?? 0];
      return `${escapeIdentifier(name)} = $${i + 1}::${column?.type ?? 'text'}`;
    })
    .join(' AND ');
  let deleted = 0;
  let updated = 0;
  const present = new Set<string>();
  for (const row of existing) {
    const key = keyOf(row);
    const want = wanted.get(key);
    if (!want) {
      if (table.appendOnly) {
        throw new Error(
          `${table.key}: the target holds a migration row the source lacks, and the table is append-only`,
        );
      }
      await target.query(
        `DELETE FROM ${q(table.key)} WHERE ${pkWhere}`,
        pkIndex.map((i) => row[i]),
      );
      deleted += 1;
      continue;
    }
    present.add(key);
    const differing = table.columns.filter((_, i) => row[i] !== want[i]);
    if (!differing.length) continue;
    if (table.appendOnly) {
      // Its rows cannot be touched; a row that says the same and was only written at another time is fine.
      if (differing.every((c) => TIMESTAMPS.has(c.name))) continue;
      throw new Error(
        `${table.key}: a migration row differs from the source (${differing.map((c) => c.name).join(', ')}) and the table is append-only`,
      );
    }
    // The key stays as it is (an identity column takes no value in an UPDATE).
    const rest = table.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => !table.primaryKey.includes(column.name));
    const assignments = rest
      .map(
        ({ column }, i) =>
          `${escapeIdentifier(column.name)} = $${table.primaryKey.length + i + 1}::${column.type}`,
      )
      .join(', ');
    await target.query(`UPDATE ${q(table.key)} SET ${assignments} WHERE ${pkWhere}`, [
      ...pkIndex.map((i) => row[i]),
      ...rest.map(({ index }) => want[index] ?? null),
    ]);
    updated += 1;
  }
  const fresh = rows.filter((row) => !present.has(keyOf(row)));
  await insertRows(target, table, fresh);
  return { inserted: fresh.length, updated, deleted, late };
}

async function resetSequences(target: Client, table: SeedTable): Promise<number> {
  let count = 0;
  for (const column of table.columns) {
    if (!column.sequence) continue;
    await target.query(
      `SELECT setval($1::regclass, m.max) FROM (SELECT max(${escapeIdentifier(column.name)}) AS max FROM ${q(table.key)}) m
       WHERE m.max IS NOT NULL`,
      [column.sequence],
    );
    count += 1;
  }
  return count;
}

/**
 * Copies the master data. Both clients are connected by the caller: `source` to the database that
 * holds the master data (only read, in one read-only snapshot), `target` to the empty, migrated
 * database as the role that owns its tables. All or nothing: any refusal rolls the target back.
 */
export async function runStoreSeed(
  source: Client,
  target: Client,
  options: { dryRun: boolean; log?: (line: string) => void },
): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  await prepareSession(source);
  await prepareSession(target);
  await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const plan = await planStoreSeed(source, target);
    if (options.dryRun || plan.problems.length) return { plan, copied: [], sequences: 0 };

    const tables = await readTables(source);
    const fks = await readForeignKeys(source);
    const copied: SeedResult['copied'] = [];
    const lateWrites: LateWrite[] = [];
    let sequences = 0;
    await target.query('BEGIN');
    try {
      await target.query(`SET LOCAL lock_timeout = '10s'`);
      for (const key of plan.order) {
        const table = tables.get(key);
        if (!table) throw new Error(`${key} vanished from the source`);
        const { late, ...done } = await copyTable(source, target, table, fks);
        copied.push({ key, ...done });
        lateWrites.push(...late);
        log(`${key}: ${done.inserted} rows`);
      }
      for (const write of lateWrites) await writeLate(target, write);
      for (const key of plan.order) {
        const table = tables.get(key);
        if (table) sequences += await resetSequences(target, table);
      }
      // Proof before the commit: every copied table holds what was planned, every other table
      // holds what it held.
      for (const planned of plan.tables) {
        const now = await countRows(target, planned.key);
        const expected = planned.class === 'copy' ? planned.copyRows : planned.targetRows;
        if (now !== expected) {
          throw new Error(`${planned.key}: ${now} rows after the copy, ${expected} expected`);
        }
      }
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    return { plan, copied, sequences };
  } finally {
    await source.query('ROLLBACK').catch(() => undefined);
  }
}

/** Object names of the files whose rows the seed copies, for carrying the files themselves. */
export async function seededFileKeys(source: Client): Promise<string[]> {
  const tables = await readTables(source);
  const table = tables.get('public.files');
  if (!table || ruleOf('public.files').class !== 'copy') return [];
  const fks = await readForeignKeys(source);
  const { rows } = await source.query<{ key: string }>(
    `SELECT key FROM public.files ${sourceFilter(table, fks)} ORDER BY key`,
  );
  return rows.map((row) => row.key);
}
