#!/usr/bin/env node
// The guard: a Claude Code PreToolUse hook for the Bash tool (tools/brain/README.md). It stops any
// session on this PC from running the few commands Bto's rules forbid. Only clear cases are
// blocked: a false block costs more than a miss. The idea is from ECC's block-no-verify hook
// (github.com/affaan-m/ECC, MIT), rewritten for Bto's rules.
//
// Claude Code sends the call as JSON on stdin ({ tool_input: { command }, cwd }). Exit 2 with one
// line on stderr blocks the command; exit 0 lets it run. Any error lets it run: a broken guard
// must never break a session.
//   node tools/brain/guard.mjs   (installed by tools/brain/install.sh into ~/.claude/settings.json)
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real system's database port (CLAUDE.md: nothing in the development checkouts names it).
const REAL_DB_PORT = '15433';

/**
 * A shell command → its simple commands, each a list of words with the quotes taken off.
 * Splits on ; & | && || newlines and parentheses; skips comments and heredoc bodies; a $( … )
 * or `…` stays inside the word it is in (its text is not checked).
 */
export function commands(text) {
  const list = [];
  let words = [];
  let word = null;
  let at = 0;
  const heredocs = [];
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) list.push(words);
    words = [];
  };
  // Skips a $( … ) from `at` (just after the opening paren); returns the index after the `)`.
  const skipSubstitution = (from) => {
    let depth = 1;
    let i = from;
    while (i < text.length && depth > 0) {
      const char = text[i];
      if (char === '\\') i += 2;
      else if (char === "'") i = text.indexOf("'", i + 1) + 1 || text.length;
      else if (char === '"') {
        i += 1;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i += 1;
          else if (text.startsWith('$(', i)) i = skipSubstitution(i + 2) - 1;
          i += 1;
        }
        i += 1;
      } else if (char === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
        const head = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(text.slice(i));
        if (head) {
          i = skipHeredoc(text.indexOf('\n', i), head[2], head[0].startsWith('<<-'));
        } else i += 2;
      } else {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        i += 1;
      }
    }
    return i;
  };
  // From the newline that starts a heredoc's body: the index of the newline after its last line.
  const skipHeredoc = (newline, delimiter, tabs) => {
    if (newline < 0) return text.length;
    let i = newline;
    while (i < text.length) {
      const next = text.indexOf('\n', i + 1);
      const line = text.slice(i + 1, next < 0 ? text.length : next);
      if ((tabs ? line.replace(/^\t+/, '') : line) === delimiter)
        return next < 0 ? text.length : next;
      if (next < 0) return text.length;
      i = next;
    }
    return text.length;
  };
  const append = (part) => {
    word = (word ?? '') + part;
  };

  while (at < text.length) {
    const char = text[at];
    if (char === '\\') {
      if (text[at + 1] !== '\n') append(text[at + 1] ?? '');
      at += 2;
    } else if (char === "'") {
      const close = text.indexOf("'", at + 1);
      const end = close < 0 ? text.length : close;
      append(text.slice(at + 1, end));
      at = end + 1;
    } else if (char === '"') {
      let part = '';
      at += 1;
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\' && '"\\$`\n'.includes(text[at + 1])) {
          part += text[at + 1];
          at += 2;
        } else if (text.startsWith('$(', at)) {
          const end = skipSubstitution(at + 2);
          part += text.slice(at, end);
          at = end;
        } else {
          part += text[at];
          at += 1;
        }
      }
      append(part);
      at += 1;
    } else if (text.startsWith('$(', at)) {
      const end = skipSubstitution(at + 2);
      append(text.slice(at, end));
      at = end;
    } else if (char === '`') {
      const close = text.indexOf('`', at + 1);
      const end = close < 0 ? text.length : close + 1;
      append(text.slice(at, end));
      at = end;
    } else if (char === '#' && word === null) {
      const next = text.indexOf('\n', at);
      at = next < 0 ? text.length : next;
    } else if (char === '<' && text[at + 1] === '<' && text[at + 2] !== '<') {
      const head = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(text.slice(at));
      endWord();
      if (head) {
        heredocs.push({ delimiter: head[2], tabs: head[0].startsWith('<<-') });
        at += head[0].length;
      } else at += 2;
    } else if (char === '\n') {
      endCommand();
      at += 1;
      for (const { delimiter, tabs } of heredocs.splice(0)) {
        at = skipHeredoc(at - 1, delimiter, tabs) + 1;
      }
    } else if (';&|()'.includes(char)) {
      endCommand();
      at += 1;
    } else if (char === ' ' || char === '\t') {
      endWord();
      at += 1;
    } else {
      append(char);
      at += 1;
    }
  }
  endCommand();
  return list;
}

/** Leading assignments and wrappers (sudo, env, timeout …) off: the words of the real program. */
function program(words) {
  let i = 0;
  for (;;) {
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i += 1;
    const name = words[i];
    if (name === 'sudo' || name === 'env' || name === 'command' || name === 'exec') {
      i += 1;
      while (i < words.length && words[i].startsWith('-')) i += 1;
    } else if (name === 'nohup' || name === 'time') i += 1;
    else if (name === 'timeout') {
      i += 1;
      while (i < words.length && words[i].startsWith('-')) i += 1;
      i += 1; // the duration
    } else return words.slice(i);
  }
}

const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);
const place = (dir, home, cwd) => resolve(cwd, dir.replace(/^~(?=$|\/)/, home));

/** A short-option cluster (-an) holds `letter` before any option that takes the rest as a value. */
function cluster(word, letter, takesValue) {
  if (!/^-[A-Za-z]+$/.test(word)) return false;
  for (const char of word.slice(1)) {
    if (char === letter) return true;
    if (takesValue.includes(char)) return false;
  }
  return false;
}

// Options whose value is the next word, per git command (so `-m "add -A"` is a message, not -A).
const GIT_VALUES = {
  commit: [
    '-m',
    '-F',
    '-C',
    '-c',
    '-t',
    '--message',
    '--file',
    '--author',
    '--date',
    '--template',
    '--reuse-message',
    '--reedit-message',
    '--fixup',
    '--squash',
    '--trailer',
    '--cleanup',
  ],
  merge: ['-m', '-F', '-s', '-X', '--message', '--file', '--strategy', '--strategy-option'],
  rebase: ['-s', '-X', '-x', '--strategy', '--strategy-option', '--exec', '--onto'],
  push: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
  add: ['--chmod', '--pathspec-from-file'],
};

/** The checks of one git command. */
function checkGit(words, cwd, home) {
  let i = 1;
  let dir = cwd;
  while (i < words.length && words[i].startsWith('-')) {
    const option = words[i];
    if (option === '-C') {
      dir = place(words[i + 1] ?? '.', home, dir);
      i += 2;
    } else if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(option)) i += 2;
    else i += 1;
  }
  // The real system's checkout and its deploy timer are not the sessions' to police.
  if (inside(dir, `${home}/bto`)) return null;
  const verb = words[i];
  const valued = GIT_VALUES[verb] ?? [];
  const flags = [];
  const operands = [];
  for (let j = i + 1; j < words.length; j += 1) {
    const word = words[j];
    if (word === '--') {
      operands.push(...words.slice(j + 1));
      break;
    }
    if (word.startsWith('-') && word !== '-') {
      flags.push(word);
      if (valued.includes(word)) j += 1;
      // -mtext carries its value; -am takes the next word.
      else if (verb === 'commit' && /^-[A-Za-z]*[mFCct]$/.test(word)) j += 1;
    } else operands.push(word);
  }

  if (['commit', 'push', 'merge', 'rebase'].includes(verb)) {
    if (
      flags.includes('--no-verify') ||
      (verb === 'commit' && flags.some((f) => cluster(f, 'n', 'mFCctuS')))
    ) {
      return `git ${verb} --no-verify skips the checks (Bto rule: never bypass the hooks): drop the flag and fix what they find`;
    }
  }
  if (verb === 'add') {
    const all = flags.some((f) => f === '--all' || cluster(f, 'A', ''));
    if (all || operands.some((o) => o === '.' || o === './' || o === ':/')) {
      return "git add -A/--all/./:/ stages other sessions' files too (Bto rule: stage your own files by name, git add <file> …)";
    }
  }
  if (verb === 'push') {
    const force = flags.some(
      (f) => f === '--force' || f.startsWith('--force-with-lease') || cluster(f, 'f', 'o'),
    );
    const refs = operands.slice(1);
    const toMain = (ref) => /^(refs\/heads\/)?main$/.test(ref.replace(/^\+/, '').split(':').pop());
    if ((force && refs.some(toMain)) || refs.some((ref) => ref.startsWith('+') && toMain(ref))) {
      return 'git push --force to main rewrites what the real system runs (Bto rule: main is never force-pushed)';
    }
  }
  return null;
}

/** The check of one docker compose / docker-compose command: down with its volumes. */
function checkCompose(words) {
  const name = basename(words[0]);
  let rest;
  if (name === 'docker-compose') rest = words.slice(1);
  else if (name === 'docker' && words.includes('compose'))
    rest = words.slice(words.indexOf('compose') + 1);
  else return null;
  const down = rest.indexOf('down');
  if (down < 0) return null;
  const after = rest.slice(down + 1);
  if (after.some((w) => w === '-v' || w === '--volumes' || w === '--volumes=true')) {
    return "docker compose down -v deletes the databases' volumes (Bto rule: never down -v on this PC); docker compose down alone keeps them";
  }
  return null;
}

/**
 * Why this command must not run, or null. Pure: tests call it.
 * @param {string} command  the Bash tool's command
 * @param {string} cwd      the session's working directory
 * @param {string} home     the home directory (~)
 */
export function check(command, cwd, home) {
  if (typeof command !== 'string' || command === '') return null;
  const where = cwd || home;
  if (
    command.includes(REAL_DB_PORT) &&
    (inside(where, `${home}/bto-dev`) || inside(where, `${home}/bto-work`))
  ) {
    return `${REAL_DB_PORT} is the real system's database (Bto rule: development never points at it); the development database is 15432`;
  }
  let dir = where;
  for (const words of commands(command)) {
    const run = program(words);
    if (run.length === 0) continue;
    const name = basename(run[0]);
    if (name === 'cd' && run.length <= 2) {
      dir = place(run[1] ?? home, home, dir);
      continue;
    }
    if ((name === 'bash' || name === 'sh') && run.length > 2 && /^-[a-z]*c[a-z]*$/.test(run[1])) {
      const inner = check(run[2], dir, home);
      if (inner) return inner;
      continue;
    }
    const reason = name === 'git' ? checkGit(run, dir, home) : checkCompose(run);
    if (reason) return reason;
  }
  return null;
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  let reason = null;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    if (!input.tool_name || input.tool_name === 'Bash') {
      reason = check(input.tool_input?.command, input.cwd || process.cwd(), homedir());
    }
  } catch {
    reason = null;
  }
  if (reason) {
    process.stderr.write(`guard: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}
