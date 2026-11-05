// What the steps of `pnpm design:build` share: where things are, which commit is being built, and
// the check of the colours against the code.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const SOURCE = path.join(HERE, 'source');
const WEB = path.join(ROOT, 'apps', 'web', 'src');
const SHARED = path.join(ROOT, 'packages', 'shared');
// tmp/ is gitignored: the built system is never committed.
const WORK = path.join(ROOT, 'tmp', 'design-system');
const OUT = path.join(WORK, 'project');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** `main@1a2b3c4d` on main, else the branch's name; the date is the commit's, so a build repeats. */
function revision() {
  const sha = git('rev-parse', '--short=8', 'HEAD');
  let onMain = false;
  try {
    git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
    onMain = true;
  } catch {
    // Not yet on origin/main: the branch's name says where it came from.
  }
  const name = onMain ? 'main' : git('rev-parse', '--abbrev-ref', 'HEAD');
  return { sha, ref: `${name}@${sha}`, date: git('log', '-1', '--format=%cs') };
}

const REPORT = [];
const report = (line) => REPORT.push(line);

// Literals the classes repeat: not variables of index.css, so nothing to compare them with.
const CLASS_LITERALS = new Set(['hairline-ring', 'overlay', 'overlay-drawer', 'segment-track']);
const isColor = (value) => /^(#|rgba?\(|hsla?\(|oklch\()/i.test(value);
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const norm = (value) => value.trim().toLowerCase().replace(/\s+/g, '');

/**
 * Takes the colours from the code where the code has them: a changed value is used and reported,
 * because its note may name a contrast that no longer holds. A new variable of index.css gets a
 * placeholder note, a removed one leaves. The phone's values are compared by name.
 */
function syncColors(color, make) {
  const css = fs.readFileSync(path.join(WEB, 'index.css'), 'utf8');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error('no :root in index.css');
  const web = new Map();
  for (const match of root[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (isColor(match[2].trim())) web.set(match[1], match[2].trim().toLowerCase());
  }
  const known = new Set();
  for (let index = color.length - 1; index >= 0; index -= 1) {
    const token = color[index];
    if (token.name.startsWith('app-') || CLASS_LITERALS.has(token.name)) continue;
    known.add(token.name);
    if (!web.has(token.name)) {
      report(`colour removed from index.css: ${token.name}`);
      color.splice(index, 1);
    } else if (norm(web.get(token.name)) !== norm(token.value)) {
      report(
        `colour changed in index.css: ${token.name} ${token.value} → ${web.get(token.name)}; check its note in tokens.cjs`,
      );
      token.value = web.get(token.name);
    }
  }
  const insertAt = color.findIndex((token) => CLASS_LITERALS.has(token.name));
  let added = 0;
  for (const [name, value] of web) {
    if (known.has(name)) continue;
    color.splice(
      insertAt + added,
      0,
      make(name, value, 'New in index.css: its note is still to write in tokens.cjs.'),
    );
    added += 1;
    report(`colour new in index.css: ${name} ${value}; write its note in tokens.cjs`);
  }

  const phone = fs.readFileSync(
    path.join(ROOT, 'apps', 'mobile', 'src', 'theme', 'tokens.ts'),
    'utf8',
  );
  const block = /export const colors = \{([\s\S]*?)\n\}/.exec(phone);
  if (!block) throw new Error('no colors in the phone tokens');
  const values = new Map(
    [...block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map((match) => [match[1], match[2]]),
  );
  for (const token of color) {
    if (!token.name.startsWith('app-')) continue;
    const value = values.get(camel(token.name.slice('app-'.length)));
    if (value !== undefined && norm(value) !== norm(token.value)) {
      report(
        `colour changed in the phone tokens: ${token.name} ${token.value} → ${value.toLowerCase()}; check its note in tokens.cjs`,
      );
      token.value = value.toLowerCase();
    }
  }
}

module.exports = {
  HERE,
  ROOT,
  SOURCE,
  WEB,
  SHARED,
  WORK,
  OUT,
  REPORT,
  report,
  revision,
  syncColors,
};
