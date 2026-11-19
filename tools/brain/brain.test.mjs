// The brain's tools (ADR-0213): mn.json merged by key, the key scan, the scripts' syntax, the guard,
// the monitor's readers.
//   node --test tools/brain/brain.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from './guard.mjs';
import { merge, parse, print } from './merge-json.mjs';
import {
  feedTranscript,
  isBrainWorker,
  landingState,
  lastTextLine,
  newSummary,
  parseDeployLine,
  parseGraphLog,
  parseLandingLine,
  parseLane,
  slugFromBrief,
  summarizeTranscript,
  tokensOf,
  workerStatus,
} from './monitor/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const json = (value) => parse(JSON.stringify(value));
const merged = (base, ours, theirs) => {
  const conflicts = [];
  const result = merge(json(base), json(ours), json(theirs), [], conflicts);
  return { text: print(result), conflicts };
};

test('mn.json keeps its exact text through parse and print', () => {
  const text = readFileSync(join(root, 'packages/shared/i18n/mn.json'), 'utf8');
  assert.equal(`${print(parse(text))}\n`, text);
});

test('keys that look like numbers keep their place', () => {
  const text = '{\n  "b": "1",\n  "130301": "2",\n  "a": "3"\n}';
  assert.equal(print(parse(text)), text);
});

test('two tasks that add keys at the end of one object both land', () => {
  const base = { finance: { save: 'Хадгалах' } };
  const { text, conflicts } = merged(
    base,
    { finance: { save: 'Хадгалах', one: 'Нэг' } },
    { finance: { save: 'Хадгалах', two: 'Хоёр' } },
  );
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { finance: { save: 'Хадгалах', two: 'Хоёр', one: 'Нэг' } });
});

test('a text one side changed and a branch the other side added', () => {
  const base = { a: { x: '1' }, b: '2' };
  const { text, conflicts } = merged(
    base,
    { a: { x: '1!' }, b: '2' },
    { a: { x: '1' }, b: '2', c: { y: '3' } },
  );
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { a: { x: '1!' }, b: '2', c: { y: '3' } });
});

test('a key one side removed stays removed', () => {
  const { text, conflicts } = merged({ a: '1', b: '2' }, { a: '1' }, { a: '1', b: '2', c: '3' });
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { a: '1', c: '3' });
});

test('the same key given two texts is a conflict, named by its path', () => {
  const { conflicts } = merged({ a: { x: '1' } }, { a: { x: 'ours' } }, { a: { x: 'theirs' } });
  assert.deepEqual(conflicts, ['a.x']);
});

test('the same new key with the same text is not a conflict', () => {
  const { conflicts } = merged({}, { a: 'x' }, { a: 'x' });
  assert.deepEqual(conflicts, []);
});

test('every translation key named in the code exists', () => {
  const run = spawnSync(process.execPath, [join(root, 'tools/fast-check/i18n-keys.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});

test('the shell tools parse', () => {
  for (const name of readdirSync(here).filter((file) => file.endsWith('.sh'))) {
    const run = spawnSync('bash', ['-n', join(here, name)], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${name}: ${run.stderr}`);
  }
});

const home = '/home/u';
const dev = `${home}/bto-dev`;
const port = '15433'; // the real system's database

test('the guard blocks what Bto forbids', () => {
  const blocked = [
    ['git commit --no-verify -m x', dev],
    ['git commit -n -m x', dev],
    ['git commit -anm x', dev],
    ['git push --no-verify origin task/x', `${home}/bto-work/x`],
    ['git merge --no-verify task/x', dev],
    ['git rebase --no-verify origin/main', dev],
    ['git add -A', dev],
    ['git add --all', dev],
    ['git add .', dev],
    ['git add :/', dev],
    ['cd apps && git add .', dev],
    ['bash -c "git add -A"', dev],
    ['git -C ~/bto-work/x add -A', home],
    ['docker compose down -v', dev],
    ['docker compose -f docker-compose.yml down --volumes', home],
    ['docker-compose down -v', `${home}/bto`],
    ['git push --force origin main', dev],
    ['git push -f origin main', dev],
    ['git push --force-with-lease origin HEAD:main', dev],
    ['git push origin +main', dev],
    [`psql -h 127.0.0.1 -p ${port} bto`, dev],
    [`DATABASE_URL=postgres://x@127.0.0.1:${port}/bto pnpm db:migrate`, `${home}/bto-work/x`],
  ];
  for (const [command, cwd] of blocked) {
    assert.ok(check(command, cwd, home), `${command} (in ${cwd}) should be blocked`);
  }
});

test('the guard lets the ordinary commands run', () => {
  const allowed = [
    ['git add apps/web/src/x.tsx', dev],
    ['git commit -m "add -A flag docs"', dev],
    ['docker compose up -d --wait', dev],
    ['docker compose down', dev],
    ['git push origin main', dev],
    ['git push --force origin task/x', dev],
    [`psql -h 127.0.0.1 -p ${port} bto`, `${home}/bto`],
    ['git log --oneline', dev],
    ['git add .', `${home}/bto`],
    ['git push -n origin main', dev],
    ['git commit -C HEAD --amend', dev],
    ["git commit -m \"$(cat <<'EOF'\nfix: don't (ever) git add . or down -v\nEOF\n)\"", dev],
    ['cat > notes.txt <<EOF\ngit add -A\nEOF', dev],
    ['echo "git add ." # docker compose down -v', dev],
    ['', dev],
  ];
  for (const [command, cwd] of allowed) {
    assert.equal(check(command, cwd, home), null, `${command} (in ${cwd})`);
  }
});

test('the guard as a hook: exit 2 with a reason, 0 otherwise, 0 on input it cannot read', () => {
  const hook = (input) =>
    spawnSync(process.execPath, [join(here, 'guard.mjs')], { input, encoding: 'utf8' });
  const blocked = hook(JSON.stringify({ tool_input: { command: 'git add -A' }, cwd: dev }));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^guard: .*by name/);
  assert.equal(hook(JSON.stringify({ tool_input: { command: 'ls' }, cwd: dev })).status, 0);
  assert.equal(hook('not json').status, 0);
});

// --- the monitor (monitor/serve.mjs) ---

test('monitor: a lane is its paths, one per line', () => {
  assert.deepEqual(parseLane('apps/web/src/a.tsx\n\n  tools/brain/monitor \n'), [
    'apps/web/src/a.tsx',
    'tools/brain/monitor',
  ]);
  assert.deepEqual(parseLane(''), []);
});

test('monitor: a landing line, and lines that are not one', () => {
  const landing = parseLandingLine(
    '2026-11-19 23:52:20 cd208794 rep-offline-api rep-offline-outbox',
  );
  assert.equal(landing.sha, 'cd208794');
  assert.deepEqual(landing.slugs, ['rep-offline-api', 'rep-offline-outbox']);
  assert.equal(landing.at, new Date('2026-11-19T23:52:20').getTime());
  assert.equal(parseLandingLine('2026-11-19 23:52:20 cd208794'), null);
  assert.equal(parseLandingLine('garbage'), null);
  assert.equal(parseLandingLine(''), null);
});

const deployLog = [
  '2026-11-19 23:52:24 cd208794: тавьж эхэллээ (deploy, 41 файл, касс: yes, CI pending)',
  '2026-11-19 23:57:42 cd208794: ажиллаж байна (төв 276 сек, касс 42 сек)',
  '2026-11-20 00:10:54 CI ногоон: cd208794',
  '2026-11-19 17:25:57 341b2118: зөвхөн баримт бичиг, тест эсвэл хэрэгсэл өөрчлөгдсөн тул шилжүүлээд, дахин бүтээсэнгүй',
  '2026-11-19 14:44:54 CI d1f31b6e-ийг шинэ push-ийн улмаас зогсоосон: буцаахгүй',
  '2026-11-18 10:00:00 CI улаан: aaaa1111 → өмнөх хувилбар руу буцаалаа (bbbb2222)',
  '2026-11-18 11:00:00 CI улаан: cccc3333, БУЦААЖ ЧАДСАНГҮЙ (migration эсвэл өмнөх image алга), засвар push хийтэл энэ хувилбар ажиллана: runs/cccc3333.log',
  '2026-11-18 12:00:00 dddd4444: тавьж эхэллээ (web, 3 файл, касс: no, CI pending)',
  '2026-11-18 12:01:00 GitHub-ээс татаж чадсангүй; дараагийн минутад дахин оролдоно',
  'not a line',
];

test('monitor: the auto-deploy log is read line by line', () => {
  const events = deployLog.map(parseDeployLine);
  assert.deepEqual(
    events.map((e) => e && [e.sha, e.kind]),
    [
      ['cd208794', 'started'],
      ['cd208794', 'live'],
      ['cd208794', 'ci-green'],
      ['341b2118', 'moved'],
      ['d1f31b6e', 'ci-cancelled'],
      ['aaaa1111', 'ci-red'],
      ['cccc3333', 'ci-red-stuck'],
      ['dddd4444', 'started'],
      [null, 'other'],
      null,
    ],
  );
});

test('monitor: whether a landing runs on the real system', () => {
  const events = deployLog.map(parseDeployLine).filter(Boolean);
  assert.deepEqual(landingState('cd208794', events, 'cd208794', false), {
    state: 'live',
    ci: 'green',
  });
  // Documents only: the checkout moved, the running version did not change.
  assert.deepEqual(landingState('341b2118', events, 'cd208794', false), {
    state: 'live',
    ci: null,
  });
  // An older landing inside the running version.
  assert.deepEqual(landingState('59ba54a4', events, 'cd208794', true), { state: 'live', ci: null });
  assert.deepEqual(landingState('aaaa1111', events, 'bbbb2222', false), {
    state: 'rolled-back',
    ci: 'red',
  });
  assert.deepEqual(landingState('cccc3333', events, 'bbbb2222', false), {
    state: 'stuck',
    ci: 'red',
  });
  assert.deepEqual(landingState('dddd4444', events, 'cd208794', false), {
    state: 'deploying',
    ci: null,
  });
  assert.deepEqual(landingState('eeee5555', events, 'cd208794', false), {
    state: 'pending',
    ci: null,
  });
  assert.deepEqual(landingState('d1f31b6e', events, null, false).ci, 'cancelled');
});

test('monitor: the code graph is idle, running, stale or failed', () => {
  const now = new Date('2026-11-20T00:00:00').getTime();
  const ok = '== 2026-11-19 23:52:20 cd208794\nbuilding…\n== ok in 204 s\n';
  assert.deepEqual(parseGraphLog(ok, now), {
    state: 'idle',
    at: new Date('2026-11-19T23:52:20').getTime(),
    sha: 'cd208794',
    seconds: 204,
  });
  assert.equal(parseGraphLog(`${ok}== 2026-11-19 23:58:00 abcd1234\n`, now).state, 'running');
  assert.equal(parseGraphLog(`${ok}== 2026-11-19 22:00:00 abcd1234\n`, now).state, 'stale');
  assert.equal(
    parseGraphLog('== 2026-11-19 23:00:00 abcd1234\n== FAILED in 9 s\n', now).state,
    'failed',
  );
  assert.equal(parseGraphLog('', now).state, 'none');
});

test('monitor: a worker is tied to its task by the Copy line of its brief, and nothing else', () => {
  assert.equal(
    slugFromBrief('Task: x\nCopy: ~/bto-work/brain-monitor   Branch: task/brain-monitor'),
    'brain-monitor',
  );
  assert.equal(slugFromBrief('Copy: /home/someone/bto-work/label-print-api'), 'label-print-api');
  assert.equal(slugFromBrief('Copy: ~/bto-work/_gate'), null);
  assert.equal(slugFromBrief('work in ~/bto-dev'), null);
  assert.equal(slugFromBrief(undefined), null);
  assert.equal(isBrainWorker({ agentType: 'bto-scout' }, null), true);
  assert.equal(isBrainWorker({ agentType: 'general-purpose' }, 'cash-fix'), true);
  assert.equal(isBrainWorker({ agentType: 'Explore' }, null), false);
});

const line = (value) => JSON.stringify(value);
const reply = (
  id,
  at,
  content,
  usage = {
    input_tokens: 2,
    output_tokens: 100,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 10,
  },
) =>
  line({
    type: 'assistant',
    timestamp: at,
    message: { id, model: 'claude-sonnet-5-5', usage, content },
  });
const transcript = [
  line({
    type: 'user',
    timestamp: '2026-11-20T00:00:00.000Z',
    message: {
      role: 'user',
      content:
        'Task: secret plan\nCopy: ~/bto-work/cash-fix   Branch: task/cash-fix\nDetails: the password is hunter2',
    },
  }),
  line({
    type: 'api-request',
    timestamp: '2026-11-20T00:00:01.000Z',
    querySource: 'agent:custom:bto-ui',
  }),
  // One reply written as two lines with the same usage: counted once.
  reply('msg_1', '2026-11-20T00:00:05.000Z', [{ type: 'thinking', thinking: 'hm' }]),
  reply('msg_1', '2026-11-20T00:00:05.000Z', [
    { type: 'tool_use', name: 'Bash', input: { command: 'cat apps/api/.env' } },
  ]),
  line({
    type: 'user',
    timestamp: '2026-11-20T00:00:06.000Z',
    message: { content: [{ type: 'tool_result', content: 'DATABASE_URL=postgres://x' }] },
  }),
  line({ type: 'something-new', timestamp: '2026-11-20T00:09:00.000Z' }),
  reply('msg_2', '2026-11-20T00:12:00.000Z', [
    { type: 'tool_use', name: 'Edit', input: { file_path: '/x' } },
    {
      type: 'text',
      text: '```\nRESULT: DONE\nWhat changed: the cash screen shows the total.\nFiles: a.tsx\n```',
    },
  ]),
  '{"type":"assistant","timestamp":"2026-11-20T00:13:00.000Z","message":{"content":[{"type":"text","te',
].join('\n');

test('monitor: a transcript is summarised without its brief, inputs or outputs', () => {
  const summary = summarizeTranscript(transcript);
  assert.equal(summary.slug, 'cash-fix');
  assert.equal(summary.model, 'claude-sonnet-5-5');
  assert.equal(summary.lastTool, 'Edit');
  assert.equal(summary.result, 'DONE');
  assert.equal(summary.lastText, 'What changed: the cash screen shows the total.');
  assert.equal(summary.startedAt, Date.parse('2026-11-20T00:00:00.000Z'));
  assert.equal(summary.lastAt, Date.parse('2026-11-20T00:12:00.000Z'));
  assert.deepEqual(tokensOf(summary), {
    input: 4,
    output: 200,
    cacheRead: 2000,
    cacheWrite: 20,
    total: 2224,
  });
  const shown = JSON.stringify({ ...summary, usage: [...summary.usage] });
  for (const secret of ['secret plan', 'hunter2', 'DATABASE_URL', 'apps/api/.env', 'Details']) {
    assert.ok(!shown.includes(secret), `${secret} leaked`);
  }
});

test('monitor: a transcript read in two pieces sums the same as read whole', () => {
  const lines = transcript.split('\n');
  const summary = newSummary();
  feedTranscript(summary, lines.slice(0, 3));
  feedTranscript(summary, lines.slice(3));
  assert.deepEqual(tokensOf(summary), tokensOf(summarizeTranscript(transcript)));
  assert.equal(summary.lastTool, 'Edit');
});

test('monitor: a last text line is one line, cut short', () => {
  assert.equal(lastTextLine('## Done\n\n- all checks green\n```'), 'all checks green');
  const long = lastTextLine(`x ${'a'.repeat(400)}`);
  assert.equal(long.length, 160);
  assert.ok(long.endsWith('…'));
  assert.equal(lastTextLine(''), '');
});

test('monitor: running, finished or stalled', () => {
  const now = Date.parse('2026-11-20T01:00:00Z');
  assert.equal(workerStatus({ finished: true }, now, now), 'finished');
  assert.equal(workerStatus({}, now - 5 * 60_000, now), 'running');
  assert.equal(workerStatus({ finished: false }, now - 30 * 60_000, now), 'stalled');
});
