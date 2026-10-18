// docs/modules/finance-core.md §3.2 rule 7: only the Finance Core (and the migrations) name a
// relation of schema `fin` in SQL. The grants do not hold the boundary (`app` can write every `fin`
// table), so this scan of every string in apps/api/src does.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'apps', 'api', 'src');
const SKIPPED = ['apps/api/src/finance-core/', 'apps/api/src/db/migrations/'];
/**
 * A `fin` relation in a string that reads as SQL. Not relations: `fin.company_ids`, the company
 * scope setting (ADR-0076), contract ids such as `fin.intake/1` and job names such as `fin.submit`.
 */
const FIN_RELATION = /\bfin\.(?!company_ids\b)[a-z_][a-z0-9_]*\b(?!\/)|"fin"\."/;
const SQL_WORDS =
  /\b(select|insert|update|delete|from|join|into|table|truncate|references|lock)\b/i;
const namesFinRelation = (text) => FIN_RELATION.test(text) && SQL_WORDS.test(text);
const STRINGS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

/** Every string of `code` that names a `fin` relation. */
export function finRelationsIn(code, fileName = 'file.ts') {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (STRINGS.has(node.kind) && namesFinRelation(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('the scan finds fin relations in strings and templates only', () => {
  assert.equal(finRelationsIn('db.execute(sql`SELECT * FROM fin.journal_lines`);').length, 1);
  assert.equal(finRelationsIn("const q = 'UPDATE fin.open_items SET x = 1';").length, 1);
  assert.equal(finRelationsIn('sql`DELETE FROM "fin"."documents" WHERE id = ${id}`;').length, 1);
  assert.deepEqual(
    finRelationsIn("const c = { contract: 'fin.intake/1.0' }; enqueue('fin.submit');"),
    [],
  );
  assert.deepEqual(finRelationsIn('// reads fin.documents through FinReader\nconst a = 1;'), []);
  assert.deepEqual(finRelationsIn("set_config('fin.company_ids', '{1}', true)"), []);
  assert.deepEqual(finRelationsIn("const finance = 'finance.read';"), []);
});

test('no SQL outside the Finance Core names a fin relation', () => {
  const offenders = sources(SRC).flatMap((path) => {
    const file = relative(ROOT, path).split(sep).join('/');
    if (SKIPPED.some((prefix) => file.startsWith(prefix))) return [];
    return finRelationsIn(readFileSync(path, 'utf8'), file).map((text) => `${file}: ${text}`);
  });
  assert.deepEqual(offenders, []);
});
