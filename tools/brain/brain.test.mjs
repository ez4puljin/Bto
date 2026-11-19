// The brain's tools (ADR-0213): mn.json merged by key, the key scan, the scripts' syntax, the guard,
// the monitor's readers, the job desk (ADR-0229).
//   node --test tools/brain/brain.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from './guard.mjs';
import { deskRefusal, isRunner, parseRecord, runningJobs } from './jobs/desk.mjs';
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

// --- the job desk (job.sh, jobs/desk.mjs; ADR-0229) ---
// job.sh runs against a scratch repository (an «origin» and its clone as ~/bto-dev), scratch books
// and a fake build: BTO_JOB_COMMAND stands for Gradle, BTO_JOB_PUBLISH for the publish. A fake build
// writes the commit it was run from to `builds` and waits for the file `go`.

const FAKE_BUILD = [
  'git rev-parse HEAD >>"$DESK_DIR/builds"',
  'i=0; while [ ! -e "$DESK_DIR/go" ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i+1)); done',
  '[ ! -e "$DESK_DIR/fail" ] || exit 7',
  'mkdir -p apps/mobile/build/apk',
  'echo apk >"apps/mobile/build/apk/bto-staff-0.1.0-$(date +%s%N).apk"',
].join('\n');
const FAKE_PUBLISH = [
  'if [ -e "$DESK_DIR/pubhold" ]; then',
  '  i=0; while [ ! -e "$DESK_DIR/pubgo" ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i+1)); done',
  'fi',
  'echo "$ARTIFACT" >>"$DESK_DIR/published"',
].join('\n');

function makeDesk(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bto-desk-'));
  const main = join(dir, 'bto-dev');
  const env = {
    ...process.env,
    BTO_WORK: join(dir, 'bto-work'),
    BTO_BASE_REF: 'origin/main',
    BTO_JOB_COMMAND: FAKE_BUILD,
    BTO_JOB_PUBLISH: FAKE_PUBLISH,
    BTO_JOB_BUSY_PATTERN: '',
    DESK_DIR: dir,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...extraEnv,
  };
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd: main, env, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  spawnSync('git', ['init', '-q', '--bare', '--initial-branch=main', join(dir, 'origin.git')], {
    env,
  });
  spawnSync('git', ['clone', '-q', join(dir, 'origin.git'), main], { env });
  git('checkout', '-q', '-b', 'main');
  mkdirSync(join(main, 'tools/brain/jobs'), { recursive: true });
  for (const name of ['lib.sh', 'job.sh'])
    cpSync(join(here, name), join(main, 'tools/brain', name));
  for (const name of readdirSync(join(here, 'jobs')).filter((file) => file.endsWith('.job'))) {
    cpSync(join(here, 'jobs', name), join(main, 'tools/brain/jobs', name));
  }
  mkdirSync(join(main, 'apps/mobile/src'), { recursive: true });
  writeFileSync(join(main, '.gitignore'), 'node_modules/\napps/mobile/build/\n');
  writeFileSync(
    join(main, 'apps/mobile/src/a.ts'),
    "import { m } from '@tugeel/shared/money';\nexport const a = m;\n",
  );
  const shared = {
    'packages/shared/src/money/index.ts': "import { t } from '../time';\nexport const m = t;\n",
    'packages/shared/src/time/index.ts': 'export const t = 1;\n',
    'packages/shared/src/ebarimt-check/index.ts': 'export const e = 1;\n',
    'packages/api-client/src/schema.ts': 'export type S = 1;\n',
  };
  for (const [file, text] of Object.entries(shared)) {
    mkdirSync(dirname(join(main, file)), { recursive: true });
    writeFileSync(join(main, file), text);
  }
  mkdirSync(join(main, 'docs'));
  writeFileSync(join(main, 'docs/a.md'), 'a\n');
  git('add', '.gitignore', 'tools', 'apps', 'packages', 'docs');
  git('commit', '-q', '-m', 'start');
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  const books = join(dir, 'bto-work/.brain');
  mkdirSync(join(books, 'lanes'), { recursive: true });
  const job = (...args) =>
    spawnSync('bash', [join(main, 'tools/brain/job.sh'), ...args], {
      cwd: main,
      env,
      encoding: 'utf8',
    });
  const jobAsync = (...args) =>
    new Promise((done) => {
      const child = spawn('bash', [join(main, 'tools/brain/job.sh'), ...args], { cwd: main, env });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.on('close', (status) => done({ status, stdout: out }));
    });
  const push = (file, text) => {
    mkdirSync(dirname(join(main, file)), { recursive: true });
    writeFileSync(join(main, file), text);
    git('add', file);
    git('commit', '-q', '-m', `change ${file}`);
    git('push', '-q', 'origin', 'main');
    return git('rev-parse', 'HEAD');
  };
  const kind = join(books, 'jobs', 'apk-staff');
  const record = (name) =>
    existsSync(join(kind, name)) ? parseRecord(readFileSync(join(kind, name), 'utf8')) : null;
  const builds = () =>
    existsSync(join(dir, 'builds'))
      ? readFileSync(join(dir, 'builds'), 'utf8').trim().split('\n')
      : [];
  const published = () =>
    existsSync(join(dir, 'published'))
      ? readFileSync(join(dir, 'published'), 'utf8').trim().split('\n')
      : [];
  const go = () => writeFileSync(join(dir, 'go'), '');
  const until = async (what, check) => {
    for (let i = 0; i < 300; i += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  // Idle: no job running and none waiting to start.
  const idle = () => until('the desk to be idle', () => !existsSync(join(kind, 'running')));
  const close = async () => {
    go();
    await idle();
    await new Promise((resolve) => setTimeout(resolve, 200));
    rmSync(dir, { recursive: true, force: true });
  };
  const recordOf = (kindName, name) => {
    const file = join(books, 'jobs', kindName, name);
    return existsSync(file) ? parseRecord(readFileSync(file, 'utf8')) : null;
  };
  return {
    dir,
    main,
    books,
    job,
    jobAsync,
    push,
    record,
    recordOf,
    builds,
    published,
    go,
    until,
    idle,
    close,
  };
}

test('desk: nobody holds it, so a request starts the build at once and copies the APK out', async () => {
  const desk = makeDesk();
  try {
    const started = desk.job('request', 'apk-staff', '--by', 'brain');
    assert.equal(started.status, 0, started.stderr);
    assert.match(started.stdout, /^STARTED: apk-staff/);
    desk.go();
    await desk.until('the build', () => desk.record('last')?.status === 'ok');
    const last = desk.record('last');
    assert.equal(last.published, 'no');
    assert.ok(last.artifact.startsWith(join(desk.main, 'apps/mobile/build/apk/bto-staff-')));
    assert.ok(existsSync(last.artifact));
    assert.equal(desk.builds().length, 1);
    assert.deepEqual(desk.published(), []);
    // The same change asked again: the last build has it; with --publish it is published now.
    const again = desk.job('request', 'apk-staff', '--publish', '--by', 'brain');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^ALREADY/);
    assert.deepEqual(desk.published(), [last.artifact]);
    assert.equal(desk.builds().length, 1);
  } finally {
    await desk.close();
  }
});

test('desk: a task holding the app keeps the build waiting until it lands', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.books, 'lanes/label-app'), 'apps/mobile/x\n');
    writeFileSync(join(desk.books, 'lanes/web-thing'), 'apps/web/src\n');
    const queued = desk.job('request', 'apk-staff', '--by', 'brain');
    assert.equal(queued.status, 3, queued.stderr);
    assert.match(queued.stdout, /^QUEUED/);
    assert.match(queued.stdout, /task label-app/);
    assert.doesNotMatch(queued.stdout, /web-thing/);
    desk.job('tick');
    assert.equal(existsSync(join(desk.books, 'jobs/apk-staff/running')), false);
    rmSync(join(desk.books, 'lanes/label-app'));
    const tick = desk.job('tick');
    assert.match(tick.stdout, /STARTED: apk-staff/);
    desk.go();
    await desk.until('the build', () => desk.record('last')?.status === 'ok');
    assert.equal(desk.builds().length, 1);
  } finally {
    await desk.close();
  }
});

test('desk: two requests while others work make exactly one build, which publishes if one asked', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.books, 'lanes/label-app'), 'apps/mobile\n');
    assert.equal(desk.job('request', 'apk-staff', '--by', 'one').status, 3);
    assert.equal(desk.job('request', 'apk-staff', '--publish', '--by', 'two').status, 3);
    rmSync(join(desk.books, 'lanes/label-app'));
    desk.go();
    desk.job('tick');
    await desk.until('the build', () => desk.record('last')?.published === 'yes');
    const last = desk.record('last');
    assert.equal(desk.builds().length, 1);
    assert.equal(last.by, 'one, two (publish)');
    assert.deepEqual(desk.published(), [last.artifact]);
  } finally {
    await desk.close();
  }
});

test('desk: a change the running build lacks waits for the next one; a document joins', async () => {
  const desk = makeDesk();
  try {
    const first = desk.job('request', 'apk-staff', '--by', 'one');
    assert.equal(first.status, 0, first.stderr);
    const start = desk.record('running').commit;
    desk.push('docs/b.md', 'b\n');
    const joined = desk.job('request', 'apk-staff', '--by', 'docs');
    assert.equal(joined.status, 0, joined.stderr);
    assert.match(joined.stdout, /^JOINED/);
    const change = desk.push('apps/mobile/src/b.ts', 'export const b = 2;\n');
    const queued = desk.job('request', 'apk-staff', '--by', 'two');
    assert.equal(queued.status, 3, queued.stdout);
    assert.match(queued.stdout, /^QUEUED: the running apk-staff job started from/);
    desk.go();
    await desk.until('the second build', () => desk.record('last')?.commit === change);
    assert.deepEqual(desk.builds(), [start, change]);
    assert.equal(desk.record('last').by, 'two');
  } finally {
    await desk.close();
  }
});

test('desk: a want holds the build until done; a stale want holds nothing', async () => {
  const desk = makeDesk();
  try {
    assert.equal(desk.job('want', 'apk-staff', '--by', 'direct', '--note', 'map screen').status, 0);
    const queued = desk.job('request', 'apk-staff', '--by', 'brain');
    assert.equal(queued.status, 3);
    assert.match(queued.stdout, /want: direct, .*declared with job\.sh want: «map screen»/);
    const status = desk.job('status', 'apk-staff');
    assert.match(status.stdout, /holding: {3}want: direct/);
    desk.job('done', 'apk-staff', '--by', 'direct');
    assert.ok(desk.record('running'), 'done lets the waiting build start');
    desk.go();
    await desk.until('the build', () => desk.record('last')?.status === 'ok');

    desk.job('want', 'apk-staff', '--by', 'gone');
    const old = new Date(Date.now() - 3 * 3600_000);
    utimesSync(join(desk.books, 'jobs/apk-staff/wants/gone'), old, old);
    desk.push('apps/mobile/src/c.ts', 'export const c = 3;\n');
    const started = desk.job('request', 'apk-staff', '--by', 'brain');
    assert.equal(started.status, 0, started.stdout);
    assert.match(desk.job('status', 'apk-staff').stdout, /idle: {6}want: gone.*not holding/);
  } finally {
    await desk.close();
  }
});

test('desk: an api task does not hold the APK; a task holding a shared folder the app uses does', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(
      join(desk.books, 'lanes/ebarimt-api'),
      'apps/api/src/modules/ebarimt-check\npackages/api-client\npackages/shared/src/ebarimt-check\n',
    );
    writeFileSync(join(desk.books, 'lanes/time-rules'), 'packages/shared/src/time\n');
    const queued = desk.job('request', 'apk-staff', '--by', 'brain');
    assert.equal(queued.status, 3, queued.stdout);
    assert.doesNotMatch(queued.stdout, /ebarimt-api/);
    assert.match(
      queued.stdout,
      /task time-rules, .*packages\/shared\/src\/time: @tugeel\/shared\/money, which the app uses, imports it/,
    );
    rmSync(join(desk.books, 'lanes/time-rules'));
    writeFileSync(join(desk.books, 'lanes/money-rules'), 'packages/shared/src/money/round.ts\n');
    const status = desk.job('status', 'apk-staff').stdout;
    assert.match(status, /holding: {3}task money-rules/);
    assert.match(
      status,
      /because: it holds packages\/shared\/src\/money\/round\.ts: the app imports @tugeel\/shared\/money/,
    );
    assert.doesNotMatch(status, /ebarimt-api/);
    rmSync(join(desk.books, 'lanes/money-rules'));
    assert.match(desk.job('tick').stdout, /STARTED/);
  } finally {
    await desk.close();
  }
});

test('desk: uncommitted app files in ~/bto-dev hold the build; others do not', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.main, 'docs/notes.md'), 'x\n');
    writeFileSync(join(desk.main, 'apps/mobile/src/a.test.ts'), 'x\n');
    assert.equal(desk.job('request', 'apk-staff', '--by', 'x').status, 0);
    desk.go();
    await desk.idle();
    rmSync(join(desk.dir, 'go'));
    desk.push('apps/mobile/src/d.ts', 'export const d = 4;\n');
    writeFileSync(join(desk.main, 'apps/mobile/src/a.ts'), 'export const a = 2;\n');
    const queued = desk.job('request', 'apk-staff', '--by', 'y');
    assert.equal(queued.status, 3, queued.stdout);
    assert.match(
      queued.stdout,
      /~\/bto-dev, 1 uncommitted file\(s\).*apps\/mobile\/src\/a\.ts: part of the app/,
    );
  } finally {
    await desk.close();
  }
});

test('desk: a failed build is not tried again by tick, only by a new request', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.dir, 'fail'), '');
    desk.go();
    assert.equal(desk.job('request', 'apk-staff', '--publish', '--by', 'one').status, 0);
    await desk.until('the failure', () => desk.record('last')?.status === 'failed');
    assert.match(desk.record('last').reason, /exit 7/);
    assert.equal(existsSync(join(desk.books, 'jobs/apk-staff/requests')), false);
    desk.job('tick');
    desk.job('tick');
    await desk.idle();
    assert.equal(desk.builds().length, 1);
    assert.deepEqual(desk.published(), []);
    rmSync(join(desk.dir, 'fail'));
    assert.equal(desk.job('request', 'apk-staff', '--by', 'two').status, 0);
    await desk.until('the second build', () => desk.record('last')?.status === 'ok');
    assert.equal(desk.builds().length, 2);
  } finally {
    await desk.close();
  }
});

test('desk: a build that died goes back to the queue once; a second death in a row fails', async () => {
  const desk = makeDesk();
  const kill = async () => {
    await desk.until(
      'the build to run',
      () => desk.builds().length > 0 && desk.record('running')?.pid,
    );
    const pid = Number(desk.record('running').pid);
    // The runner leads its own session; the build runs in timeout's process group inside it.
    spawnSync('pkill', ['-KILL', '-s', String(pid)]);
    await desk.until('the build to die', () => {
      try {
        process.kill(pid, 0);
        return readFileSync(`/proc/${pid}/cmdline`, 'utf8') === '';
      } catch {
        return true;
      }
    });
  };
  try {
    assert.equal(desk.job('request', 'apk-staff', '--publish', '--by', 'one').status, 0);
    await kill();
    const again = desk.job('tick');
    assert.match(again.stdout, /STARTED/);
    assert.match(again.stdout, /carries: one \(publish\)/);
    await desk.until('the second run', () => desk.builds().length === 2);
    await kill();
    const stop = desk.job('tick');
    assert.doesNotMatch(stop.stdout, /STARTED/);
    assert.equal(desk.record('last').status, 'failed');
    assert.match(desk.record('last').reason, /stopped twice/);
    assert.equal(existsSync(join(desk.books, 'jobs/apk-staff/requests')), false);
    // A new request after that starts afresh, and a build that ends by itself clears the mark.
    desk.go();
    assert.equal(desk.job('request', 'apk-staff', '--by', 'two').status, 0);
    await desk.until('the third build', () => desk.record('last')?.status === 'ok');
    assert.equal(existsSync(join(desk.books, 'jobs/apk-staff/died')), false);
  } finally {
    await desk.close();
  }
});

test('desk: a request joining the running build leaves a request for a later commit queued', async () => {
  const desk = makeDesk();
  try {
    assert.equal(desk.job('request', 'apk-staff', '--by', 'one').status, 0);
    const first = desk.record('running').commit;
    const later = desk.push('apps/mobile/src/b.ts', 'export const b = 2;\n');
    assert.equal(desk.job('request', 'apk-staff', '--publish', '--by', 'two').status, 3);
    const joined = desk.job('request', 'apk-staff', '--commit', first, '--by', 'three');
    assert.match(joined.stdout, /^JOINED/);
    assert.match(joined.stdout, /carries: one, three$/m);
    const waiting = readFileSync(join(desk.books, 'jobs/apk-staff/requests'), 'utf8');
    assert.match(waiting, /\ttwo\tyes\t/);
    desk.go();
    await desk.until('the second build', () => desk.record('last')?.commit === later);
    assert.deepEqual(desk.builds(), [first, later]);
    assert.equal(desk.record('last').by, 'two (publish)');
    assert.equal(desk.published().length, 1);
  } finally {
    await desk.close();
  }
});

test('desk: a build being published still holds its group', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.dir, 'pubhold'), '');
    assert.equal(desk.job('request', 'apk-staff', '--publish', '--by', 'one').status, 0);
    assert.equal(desk.job('run', 'apk-customer', '--by', 'owner').status, 3);
    desk.go();
    await desk.until('the publish', () => desk.record('running')?.phase === 'publishing');
    assert.match(desk.job('status', 'apk-staff').stdout, /now publishing/);
    const tick = desk.job('tick');
    assert.doesNotMatch(tick.stdout, /STARTED/);
    assert.equal(desk.recordOf('apk-customer', 'running'), null);
    writeFileSync(join(desk.dir, 'pubgo'), '');
    await desk.until('the customer build', () => desk.recordOf('apk-customer', 'last') !== null);
    assert.equal(desk.record('last').published, 'yes');
    assert.equal(desk.builds().length, 2);
  } finally {
    await desk.close();
  }
});

test('desk: a hung build is stopped at its time limit and recorded failed, not died', async () => {
  const desk = makeDesk({ BTO_JOB_TIME_LIMIT_SECONDS: '1' });
  try {
    assert.equal(desk.job('request', 'apk-staff', '--by', 'one').status, 0);
    await desk.until('the time limit', () => desk.record('last')?.status === 'failed');
    assert.match(desk.record('last').reason, /time limit \(1 s\)/);
    assert.match(desk.job('status', 'apk-staff').stdout, /stopped at the time limit/);
    assert.equal(existsSync(join(desk.books, 'jobs/apk-staff/died')), false);
    desk.job('tick');
    assert.equal(desk.builds().length, 1);
  } finally {
    await desk.close();
  }
});

test("desk: reading other sessions' checkouts does not rewrite their index", () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.books, 'lanes/label-app'), 'apps/mobile\n');
    const index = join(desk.main, '.git/index');
    const old = new Date(Date.now() - 3600_000);
    utimesSync(index, old, old);
    const touched = new Date(Date.now() - 1800_000);
    utimesSync(join(desk.main, 'apps/mobile/src/a.ts'), touched, touched);
    const before = statSync(index).mtimeMs;
    desk.job('status');
    desk.job('request', 'apk-staff', '--by', 'x');
    assert.equal(statSync(index).mtimeMs, before);
  } finally {
    rmSync(desk.dir, { recursive: true, force: true });
  }
});

test('desk: two ticks at once start one build', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.books, 'lanes/label-app'), 'apps/mobile\n');
    assert.equal(desk.job('request', 'apk-staff', '--by', 'one').status, 3);
    rmSync(join(desk.books, 'lanes/label-app'));
    const ticks = await Promise.all([desk.jobAsync('tick'), desk.jobAsync('tick')]);
    assert.equal(ticks.filter((tick) => tick.stdout.includes('STARTED')).length, 1);
    desk.go();
    await desk.until('the build', () => desk.record('last')?.status === 'ok');
    await desk.idle();
    assert.equal(desk.builds().length, 1);
  } finally {
    await desk.close();
  }
});

test('desk: the owner runs it now whoever holds it; a running build holds back a second one', async () => {
  const desk = makeDesk();
  try {
    writeFileSync(join(desk.books, 'lanes/label-app'), 'apps/mobile\n');
    const run = desk.job('run', 'apk-staff', '--by', 'owner');
    assert.equal(run.status, 0, run.stdout);
    const customer = desk.job('run', 'apk-customer', '--by', 'owner');
    assert.equal(customer.status, 3, customer.stdout);
    assert.match(customer.stdout, /the apk-staff job is running/);
    desk.go();
    await desk.until(
      'both builds',
      () =>
        desk.builds().length === 2 && !existsSync(join(desk.books, 'jobs/apk-customer/running')),
    );
  } finally {
    await desk.close();
  }
});

test('desk: which kinds a path is part of', () => {
  const work = mkdtempSync(join(tmpdir(), 'bto-kinds-'));
  const kindsOf = (path) =>
    spawnSync('bash', [join(here, 'job.sh'), 'kinds-of', path], {
      encoding: 'utf8',
      env: { ...process.env, BTO_WORK: work },
    }).stdout;
  try {
    for (const path of [
      'apps/mobile/src/x.tsx',
      'apps',
      'packages/shared/src',
      'packages/shared/src/money',
    ]) {
      assert.equal(kindsOf(path), 'apk-customer\napk-staff\n', path);
    }
    for (const path of [
      'apps/web/src/x.tsx',
      'apps/mobile/src/x.test.ts',
      'docs/modules/mobile.md',
      'packages/shared/src/ebarimt-check',
      'packages/api-client',
      'packages/api-client/src/generated/schema.d.ts',
    ]) {
      assert.equal(kindsOf(path), '', path);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('desk: the APK scripts refuse ~/bto-dev and task copies without the desk', () => {
  const home = '/home/u';
  const refusal = (root, env = {}, argv = [], running = []) =>
    deskRefusal({ action: 'build', kind: 'apk-staff', root, home, env, argv, running });
  assert.match(refusal(`${home}/bto-dev`), /job\.sh request apk-staff$/m);
  assert.match(refusal(`${home}/bto-work/label-app`), /job\.sh request apk-staff/);
  assert.match(refusal(`${home}/bto-work/_jobs/android`), /job desk/);
  assert.equal(refusal(`${home}/bto-work/_jobs/android`, { BTO_JOB_DESK: '1' }), null);
  assert.equal(refusal(`${home}/bto-dev`, {}, ['--here']), null);
  assert.match(
    refusal(`${home}/bto-dev`, {}, ['--here'], [{ group: 'android' }]),
    /building an APK/,
  );
  assert.equal(refusal('C:\\work\\tugeel'), null);
  assert.equal(refusal('/home/runner/work/tugeel/tugeel'), null);
  const publish = deskRefusal({
    action: 'publish',
    kind: 'apk-customer',
    root: `${home}/bto-dev`,
    home,
    env: {},
    argv: [],
  });
  assert.match(publish, /job\.sh request apk-customer --publish/);
});

test('desk: the running builds are read from the books', () => {
  const jobs = mkdtempSync(join(tmpdir(), 'bto-jobs-'));
  try {
    mkdirSync(join(jobs, 'apk-staff'));
    writeFileSync(join(jobs, 'apk-staff/running'), 'id=1\npid=4242\ngroup=android\ncommit=abc\n');
    mkdirSync(join(jobs, 'apk-customer'));
    assert.deepEqual(
      runningJobs(jobs, (pid) => pid === 4242),
      [{ kind: 'apk-staff', group: 'android', pid: 4242, commit: 'abc' }],
    );
    assert.deepEqual(
      runningJobs(jobs, () => false),
      [],
    );
    assert.deepEqual(runningJobs(join(jobs, 'none')), []);
    // A live process that is not the desk's runner (a number reused after a restart) is no build.
    writeFileSync(join(jobs, 'apk-staff/running'), `id=1\npid=${process.pid}\ngroup=android\n`);
    assert.deepEqual(runningJobs(jobs), []);
    assert.equal(isRunner(process.pid), false);
    assert.equal(isRunner(process.pid, join(jobs, 'no-proc')), true);
  } finally {
    rmSync(jobs, { recursive: true, force: true });
  }
});

test('the guard stops a hand-made Gradle build while the desk builds', () => {
  const mirror = `${home}/Android/m/apps/mobile/android`;
  assert.match(check('./gradlew assembleRelease', mirror, home, { androidBusy: true }), /job desk/);
  assert.match(
    check('npx expo run:android', `${home}/bto-dev/apps/mobile`, home, { androidBusy: true }),
    /job desk/,
  );
  assert.equal(check('./gradlew assembleRelease', mirror, home, { androidBusy: false }), null);
  assert.equal(check('./gradlew assembleRelease', mirror, home), null);
  assert.equal(check('ls', mirror, home, { androidBusy: true }), null);
});
