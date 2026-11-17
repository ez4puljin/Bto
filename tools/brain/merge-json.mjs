#!/usr/bin/env node
// Git's merge driver for packages/shared/i18n/mn.json (.gitattributes `merge=bto-json`): two
// tasks that each add their own translation keys never conflict. Git calls it as
//   node tools/brain/merge-json.mjs %O %A %B     (ancestor, ours, theirs; the result goes into %A)
// A key both sides changed to different texts is a real conflict: exit 1 and git marks the file.
// Objects are kept as ordered lists, so the file's key order survives («130301» stays where it is).
import { readFileSync, writeFileSync } from 'node:fs';

/** JSON text → value, objects as Map (insertion order, also for keys that look like numbers). */
export function parse(text) {
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };
  function string() {
    const start = at;
    at += 1;
    while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    at += 1;
    return JSON.parse(text.slice(start, at));
  }
  function value() {
    space();
    const char = text[at];
    if (char === '{') {
      const map = new Map();
      at += 1;
      space();
      while (text[at] !== '}') {
        space();
        const key = string();
        space();
        at += 1; // the colon
        map.set(key, value());
        space();
        if (text[at] === ',') at += 1;
        space();
      }
      at += 1;
      return map;
    }
    if (char === '[') {
      const list = [];
      at += 1;
      space();
      while (text[at] !== ']') {
        list.push(value());
        space();
        if (text[at] === ',') at += 1;
        space();
      }
      at += 1;
      return list;
    }
    if (char === '"') return string();
    const start = at;
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at += 1;
    return JSON.parse(text.slice(start, at));
  }
  return value();
}

/** The value → JSON text in the file's own style (two spaces, like JSON.stringify(…, null, 2)). */
export function print(node, indent = '') {
  const inner = `${indent}  `;
  if (node instanceof Map) {
    if (node.size === 0) return '{}';
    const rows = [...node].map(
      ([key, child]) => `${inner}${JSON.stringify(key)}: ${print(child, inner)}`,
    );
    return `{\n${rows.join(',\n')}\n${indent}}`;
  }
  if (Array.isArray(node)) {
    if (node.length === 0) return '[]';
    return `[\n${node.map((child) => `${inner}${print(child, inner)}`).join(',\n')}\n${indent}]`;
  }
  return JSON.stringify(node);
}

const same = (left, right) => print(left) === print(right);

/** Three-way merge of two versions of an object; `conflicts` collects the dotted paths both changed. */
export function merge(base, ours, theirs, path, conflicts) {
  const result = new Map();
  const baseMap = base instanceof Map ? base : new Map();
  const place = (key, child) => result.set(key, child);
  // Ours first, in our order; then their new keys, each after the key it followed on their side.
  for (const [key, mine] of ours) {
    const inBase = baseMap.has(key);
    const inTheirs = theirs.has(key);
    const old = baseMap.get(key);
    const other = theirs.get(key);
    if (!inTheirs) {
      // They deleted it (keep the deletion unless we changed it), or it is our new key.
      if (inBase && same(old, mine)) continue;
      if (inBase) conflicts.push([...path, key].join('.'));
      place(key, mine);
    } else if (same(mine, other)) place(key, mine);
    else if (inBase && same(old, mine)) place(key, other);
    else if (inBase && same(old, other)) place(key, mine);
    else if (mine instanceof Map && other instanceof Map) {
      place(key, merge(old, mine, other, [...path, key], conflicts));
    } else {
      conflicts.push([...path, key].join('.'));
      place(key, mine);
    }
  }
  let previous = null;
  for (const [key, other] of theirs) {
    if (!ours.has(key)) {
      const inBase = baseMap.has(key);
      if (inBase && !same(baseMap.get(key), other)) conflicts.push([...path, key].join('.'));
      if (!inBase) {
        // Insert after `previous` (their neighbour) when we have it, else at the end.
        if (previous !== null && result.has(previous)) {
          const rebuilt = new Map();
          for (const [name, child] of result) {
            rebuilt.set(name, child);
            if (name === previous) rebuilt.set(key, other);
          }
          result.clear();
          for (const [name, child] of rebuilt) result.set(name, child);
        } else place(key, other);
      }
    }
    previous = key;
  }
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('merge-json.mjs') && process.argv.length >= 5) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  const read = (file) => parse(readFileSync(file, 'utf8'));
  const conflicts = [];
  const merged = merge(read(basePath), read(oursPath), read(theirsPath), [], conflicts);
  if (conflicts.length > 0) {
    console.error(`merge-json: both sides changed ${conflicts.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  writeFileSync(oursPath, `${print(merged)}\n`);
}
