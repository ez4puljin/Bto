import { cursorStatement, type GuardReason, guardSql, SQL_MAX_LENGTH } from './sql-guard';

async function reasonOf(sql: string): Promise<GuardReason | 'OK'> {
  const result = await guardSql(sql);
  return result.ok ? 'OK' : result.reason;
}

describe('guardSql (ADR-0045 #3)', () => {
  it.each([
    [
      'an aggregate over joined views',
      `SELECT p.category_path AS "Ангилал", count(*) AS "Тоо", sum(s.stock_value) AS "Үнэлгээ"
         FROM ai.products p JOIN stock s ON s.product_id = p.id
        WHERE p.status = 'ACTIVE' AND p.created_at >= current_date - interval '30 days'
        GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 10`,
    ],
    [
      'CTEs, UNION ALL, EXISTS, IN, BETWEEN, LIKE and CASE',
      `WITH low AS (SELECT product_id FROM low_stock WHERE status = 'OUT'),
            named AS (SELECT p.id, p.name FROM products p WHERE p.id IN (SELECT product_id FROM low))
       SELECT name, CASE WHEN id BETWEEN 1 AND 10 THEN 'эхний' ELSE 'бусад' END AS band
         FROM named
        WHERE name ILIKE '%кола%' OR name NOT LIKE 'А%' OR EXISTS (SELECT 1 FROM stock WHERE on_hand = 0)
       UNION ALL
       SELECT name, NULL FROM suppliers WHERE coalesce(phone, '') <> ''`,
    ],
    [
      'window functions, FILTER, ordered-set aggregates and DISTINCT ON',
      `SELECT DISTINCT ON (warehouse_id) warehouse_id, product_name,
              rank() OVER (PARTITION BY warehouse_id ORDER BY stock_value DESC) AS place,
              sum(on_hand) FILTER (WHERE available > 0) OVER w AS sellable,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_cost) OVER () AS median
         FROM stock WINDOW w AS (PARTITION BY warehouse_id)
        ORDER BY warehouse_id, stock_value DESC`,
    ],
    [
      'SQL-syntax functions, casts and dates',
      `SELECT extract(month FROM movement_date) AS m, substring(sku FROM 1 FOR 3), trim(product_name),
              position('а' IN product_name), posted_at AT TIME ZONE 'Asia/Ulaanbaatar',
              date_trunc('month', current_date)::date, round(sum(value)::numeric, 2),
              to_char(movement_date, 'YYYY-MM'), greatest(qty_base, 0), nullif(entered_qty, 0)
         FROM stock_movements
        GROUP BY 1, 2, 3, 4, 5, 6, 8, 9, 10`,
    ],
    [
      'a LATERAL subquery, VALUES and row comparison',
      `SELECT v.list, t.price FROM (VALUES ('WHOLESALE'), ('RETAIL')) AS v (list),
              LATERAL (SELECT price FROM prices_today p WHERE p.list = v.list LIMIT 1) t
        WHERE (1, 2) < (2, 3)`,
    ],
    ['a CTE named like a view', 'WITH stock AS (SELECT 1 AS x) SELECT x FROM stock'],
  ])('allows %s', async (_name, sql) => {
    expect(await guardSql(sql)).toEqual({ ok: true, sql: expect.any(String) });
  });

  it('returns the statement without its semicolon, counting UTF-8 bytes', async () => {
    const result = await guardSql(
      '  SELECT name AS "Нэр" FROM products WHERE name = \'Ус\';  -- сүүлийн тайлбар\n',
    );
    expect(result).toEqual({
      ok: true,
      sql: `SELECT name AS "Нэр" FROM products WHERE name = 'Ус'`,
    });
  });

  it.each<[string, string, GuardReason]>([
    ['nothing', '   ', 'EMPTY'],
    ['too much text', `SELECT '${'x'.repeat(SQL_MAX_LENGTH)}'`, 'TOO_LONG'],
    ['a syntax error', 'SELEC 1', 'SYNTAX'],
    ['two statements', 'SELECT 1; SELECT 2', 'NOT_ONE_STATEMENT'],
    ['an update', `UPDATE customers SET name = 'x'`, 'NOT_SELECT'],
    ['a delete', 'DELETE FROM customers', 'NOT_SELECT'],
    ['DDL', 'DROP VIEW ai.products', 'NOT_SELECT'],
    ['a setting', "SET statement_timeout = '0'", 'NOT_SELECT'],
    ['a transaction', 'BEGIN READ WRITE', 'NOT_SELECT'],
    ['COPY', 'COPY customers TO STDOUT', 'NOT_SELECT'],
    ['EXPLAIN ANALYZE', 'EXPLAIN ANALYZE SELECT 1', 'NOT_SELECT'],
    ['a DO block', 'DO $$ BEGIN PERFORM 1; END $$', 'NOT_SELECT'],
    [
      'a data-modifying CTE',
      'WITH d AS (DELETE FROM customers RETURNING id) SELECT * FROM d',
      'NOT_SELECT',
    ],
    [
      'WITH RECURSIVE',
      'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT n FROM r',
      'CONSTRUCT',
    ],
    ['SELECT INTO', 'SELECT * INTO copy FROM customers', 'CONSTRUCT'],
    ['FOR UPDATE', 'SELECT * FROM customers FOR UPDATE', 'CONSTRUCT'],
    [
      'FOR SHARE in a subquery',
      'SELECT * FROM (SELECT id FROM customers FOR SHARE) c',
      'CONSTRUCT',
    ],
    ['a parameter', 'SELECT * FROM customers WHERE id = $1', 'CONSTRUCT'],
    ['a catalog table', 'SELECT * FROM pg_class', 'RELATION'],
    ['pg_authid', 'SELECT rolpassword FROM pg_catalog.pg_authid', 'RELATION'],
    ['a business table', 'SELECT password_hash FROM users', 'RELATION'],
    ['a business table by schema', 'SELECT * FROM public.customers', 'RELATION'],
    ['information_schema', 'SELECT * FROM information_schema.tables', 'RELATION'],
    [
      'a CTE name behind a schema',
      'WITH users AS (SELECT 1) SELECT * FROM public.users',
      'RELATION',
    ],
    ['a CTE that reads itself', 'WITH x AS (SELECT * FROM x) SELECT * FROM x', 'RELATION'],
    ['another database', 'SELECT * FROM other.ai.products', 'RELATION'],
    ['pg_sleep', 'SELECT pg_sleep(60)', 'FUNCTION'],
    ['set_config', "SELECT set_config('default_transaction_read_only', 'off', false)", 'FUNCTION'],
    ['current_setting', "SELECT current_setting('data_directory')", 'FUNCTION'],
    ['an advisory lock', 'SELECT pg_advisory_lock(1)', 'FUNCTION'],
    ['string_agg', "SELECT string_agg(name, ',') FROM products", 'FUNCTION'],
    ['array_agg', 'SELECT array_agg(name) FROM products', 'FUNCTION'],
    ['json_agg', 'SELECT json_agg(p) FROM products p', 'FUNCTION'],
    ['repeat', "SELECT repeat('x', 100000000)", 'FUNCTION'],
    ['lpad', "SELECT lpad('x', 100000000)", 'FUNCTION'],
    ['replace', "SELECT replace(name, 'а', 'аааааааа') FROM products", 'FUNCTION'],
    ['format', "SELECT format('%1000000s', 'x')", 'FUNCTION'],
    ['large objects', "SELECT lo_import('/etc/passwd')", 'FUNCTION'],
    ['query_to_xml', "SELECT query_to_xml('select 1', true, true, '')", 'FUNCTION'],
    ['a qualified function', "SELECT public.similarity(name, 'x') FROM products", 'FUNCTION'],
    ['generate_series in the list', 'SELECT generate_series(1, 1000000)', 'FUNCTION'],
    ['current_user', 'SELECT current_user', 'FUNCTION'],
    ['a function in FROM', 'SELECT * FROM generate_series(1, 10)', 'CONSTRUCT'],
    ['TABLESAMPLE', 'SELECT * FROM products TABLESAMPLE SYSTEM (10)', 'CONSTRUCT'],
    ['ARRAY(subquery)', 'SELECT ARRAY(SELECT id FROM products)', 'CONSTRUCT'],
    ['an ARRAY constructor', 'SELECT ARRAY[1, 2]', 'CONSTRUCT'],
    ['XML', 'SELECT xmlelement(name a)', 'CONSTRUCT'],
    ['JSON constructors', "SELECT JSON_OBJECT('a': 1)", 'CONSTRUCT'],
    ['a regclass cast', "SELECT 'pg_authid'::regclass", 'TYPE'],
    ['a json cast', "SELECT '{}'::json", 'TYPE'],
    ['an array cast', "SELECT '{1}'::int[]", 'TYPE'],
    ['a regular expression', "SELECT * FROM products WHERE name ~ '^(a+)+$'", 'OPERATOR'],
    ['SIMILAR TO', "SELECT * FROM products WHERE name SIMILAR TO '%a%'", 'OPERATOR'],
    ['power', 'SELECT 10 ^ 100000', 'OPERATOR'],
    ['a qualified operator', 'SELECT 1 OPERATOR(pg_catalog.+) 1', 'OPERATOR'],
    [
      'a regular expression through ANY',
      'SELECT * FROM products WHERE name ~ ANY (SELECT name FROM suppliers)',
      'OPERATOR',
    ],
    ['ORDER BY USING', 'SELECT * FROM products ORDER BY id USING >', 'OPERATOR'],
    [
      'too many columns',
      `SELECT ${Array.from({ length: 61 }, (_, i) => `${i} AS c${i}`).join(', ')}`,
      'TOO_COMPLEX',
    ],
    [
      'too many concatenations',
      `SELECT ${Array.from({ length: 32 }, () => 'name').join(' || ')} FROM products`,
      'TOO_COMPLEX',
    ],
    ['deep nesting', `SELECT ${Array.from({ length: 400 }, () => '1').join(' + ')}`, 'TOO_COMPLEX'],
  ])('refuses %s', async (_name, sql, reason) => {
    expect(await reasonOf(sql)).toBe(reason);
  });

  it('names what the model must change', async () => {
    expect(await guardSql('SELECT * FROM users')).toEqual({
      ok: false,
      reason: 'RELATION',
      detail: expect.stringMatching(
        /^relation "users" is not available; use only the datasets categories, products, /,
      ),
    });
    expect(await guardSql("SELECT string_agg(name, ',') FROM products")).toEqual({
      ok: false,
      reason: 'FUNCTION',
      detail: 'function "string_agg" is not allowed',
    });
  });
});

describe('cursorStatement', () => {
  it('wraps one SELECT in one DECLARE', async () => {
    expect(await cursorStatement('SELECT 1', 'ai_c')).toBe(
      'DECLARE ai_c NO SCROLL CURSOR FOR\nSELECT 1\n',
    );
  });

  it('refuses anything that would not stay one DECLARE over one SELECT', async () => {
    await expect(cursorStatement('SELECT 1; DROP TABLE x', 'ai_c')).rejects.toThrow(
      'one DECLARE over one SELECT',
    );
  });
});
