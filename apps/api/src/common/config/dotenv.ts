import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Loads KEY=value pairs from a .env file into process.env for the CLI tools (db:provision, db:migrate,
 * tests). Only variables that are not set yet are filled: the real environment always wins.
 * Tolerates a UTF-8 BOM and CRLF line endings (files edited on Windows).
 */
export function loadDotEnvIfPresent(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (value !== undefined) process.env[key] ??= value;
  }
}
