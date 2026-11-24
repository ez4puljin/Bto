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
  parseInboxItem,
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

// --- the inbox gate (ADR-0242) ------------------------------------------------------------------

const inboxScript = join(here, 'inbox.sh');

function classifyPaths(...paths) {
  const work = mkdtempSync(join(tmpdir(), 'bto-inbox-class-'));
  try {
    const run = spawnSync('bash', [inboxScript, 'classify', ...paths], {
      env: { ...process.env, BTO_WORK: work },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim().split('\n');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('inbox: pages, texts, staff-app screens and documents are LIGHT', () => {
  const light = [
    'apps/web/src/features/sales/orders-page.tsx',
    'apps/web/src/features/guide/content/sales/01-orders.md',
    'apps/web/index.html',
    'packages/shared/i18n/mn.json',
    'apps/mobile/app/(staff)/picking.tsx',
    'apps/mobile/src/cart/cart-list.tsx',
    'apps/mobile/assets/icon.png',
    'docs/ui.md',
    'docs/modules/sales.md',
  ];
  const lines = classifyPaths(...light);
  assert.equal(lines.at(-1), '= LIGHT');
  for (const path of light) assert.ok(lines.includes(`LIGHT  ${path}`), path);
});

test('inbox: the api, packages, migrations, the till, configs and decisions are GUARDED', () => {
  for (const path of [
    'apps/api/src/modules/sales/orders.service.ts',
    'apps/api/src/db/migrations/0300_add_x.sql',
    'apps/api/test/integration/x.int-spec.ts',
    'apps/api/.env.example',
    'packages/shared/src/money/index.ts',
    'packages/api-client/src/schema.ts',
    'apps/web/src/pos/tender-dialog.tsx',
    'apps/web/pos.html',
    'apps/web/vite.config.ts',
    'apps/mobile/src/outbox/queue.ts',
    'apps/mobile/src/api/client.ts',
    'apps/mobile/app.config.ts',
    'apps/mobile/variants.json',
    'docs/decisions/ADR-0300-x.md',
    'docs/STATUS.md',
    'docker-compose.yml',
  ]) {
    const lines = classifyPaths('apps/web/src/a.tsx', path);
    assert.deepEqual(lines, ['LIGHT  apps/web/src/a.tsx', `GUARDED  ${path}`, '= GUARDED'], path);
  }
});

test('inbox: the guard rails are refused, whatever else comes with them', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'deploy/store/setup.sh',
    'tools/brain/land.sh',
    'tools/brain/inbox.sh',
    'CLAUDE.md',
    'AGENTS.md',
    'apps/web/AGENTS.md',
    '.claude/settings.json',
    'tools/fast-check/check-fast.mjs',
    'tools/lint-guards/guards.test.mjs',
    'tools/finance-core/whitelist.mjs',
    'ci/rehearse.sh',
    'scripts/gen-api-check.mjs',
    'eslint.config.mjs',
    'package.json',
    'apps/api/package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'apps/api/.env',
    '.env.production',
    'apps/web/src/a"b.tsx',
    'apps/web/src/tab\there.tsx',
    'apps/web/src/back\\slash.tsx',
  ]) {
    const lines = classifyPaths('apps/web/src/a.tsx', path);
    assert.match(lines[1], new RegExp(`^REFUSE  ${path.replace(/[.*\\]/g, '\\$&')}: `), path);
    assert.equal(lines.at(-1), '= REFUSED', path);
  }
});

const FAKE_CHECK = [
  "import { existsSync } from 'node:fs';",
  'if (existsSync(`${process.env.INBOX_DIR}/red`)) {',
  "  console.log('FAIL    0.1s  web types');",
  "  console.log('/home/u/bto-work/in-x/apps/web/src/a.tsx(1,1): error TS2322: wrong');",
  '  process.exit(1);',
  '}',
  "console.log('check:fast green');",
].join('\n');
const FAKE_GH =
  '#!/usr/bin/env bash\n{ printf "%s\\t" "$@" | tr "\\n" " "; echo; } >>"$INBOX_DIR/gh"\n';

function makeInbox() {
  const dir = mkdtempSync(join(tmpdir(), 'bto-inbox-'));
  const main = join(dir, 'bto-dev');
  const devDir = join(dir, 'dev');
  const origin = join(dir, 'origin.git');
  writeFileSync(join(dir, 'gh.sh'), FAKE_GH, { mode: 0o755 });
  const env = {
    ...process.env,
    BTO_WORK: join(dir, 'bto-work'),
    BTO_BASE_REF: 'origin/main',
    BTO_INBOX_GH: join(dir, 'gh.sh'),
    BTO_INBOX_REPO: 'owner/repo',
    BTO_INBOX_LOCK_WAIT: '60',
    INBOX_DIR: dir,
    GIT_COMMITTER_NAME: 'gate',
    GIT_COMMITTER_EMAIL: 'gate@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const gateEnv = { ...env, GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@example.invalid' };
  const gitIn = (cwd, runEnv, ...args) => {
    const run = spawnSync('git', args, { cwd, env: runEnv, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  const git = (...args) => gitIn(main, gateEnv, ...args);
  spawnSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin], { env });
  spawnSync('git', ['clone', '-q', origin, main], { env });
  git('checkout', '-q', '-b', 'main');
  mkdirSync(join(main, 'tools/brain'), { recursive: true });
  for (const name of ['lib.sh', 'task.sh', 'land.sh', 'inbox.sh', 'merge-json.mjs'])
    cpSync(join(here, name), join(main, 'tools/brain', name));
  const files = {
    '.gitignore': 'node_modules/\n.fastcheck/\n',
    'tools/fast-check/check-fast.mjs': `${FAKE_CHECK}\n`,
    'apps/web/src/a.tsx': 'export const a = 1;\n',
    'apps/web/src/b.tsx': 'export const b = 1;\n',
    'apps/api/src/modules/sales/s.ts': 'export const s = 1;\n',
    'packages/shared/i18n/mn.json': '{\n  "a": "А"\n}\n',
    'docs/a.md': 'a\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(main, file)), { recursive: true });
    writeFileSync(join(main, file), text);
  }
  mkdirSync(join(main, 'deploy/store'), { recursive: true });
  cpSync(join(root, 'deploy/store/auto-deploy.sh'), join(main, 'deploy/store/auto-deploy.sh'));
  git('add', '.gitignore', 'tools', 'apps', 'packages', 'docs', 'deploy');
  git('commit', '-q', '-m', 'start');
  git('push', '-q', 'origin', 'main');
  // The second developer's own clone, on another PC.
  spawnSync('git', ['clone', '-q', origin, devDir], { env });
  const devEnv = { ...env, GIT_AUTHOR_NAME: 'Dev Two', GIT_AUTHOR_EMAIL: 'dev@example.invalid' };
  const dev = (...args) => gitIn(devDir, devEnv, ...args);
  // push(branch, { file: text }, message, { from }): a branch from origin/main (or `from`), pushed.
  const push = (branch, change, message = `change for ${branch}`, { from, onTop } = {}) => {
    dev('fetch', '-q', 'origin');
    if (!onTop) dev('checkout', '-q', '-B', `w-${branch}`, from ?? 'origin/main');
    for (const [file, text] of Object.entries(change)) {
      mkdirSync(dirname(join(devDir, file)), { recursive: true });
      writeFileSync(join(devDir, file), text);
      dev('add', file);
    }
    dev('commit', '-q', '-m', message);
    dev('push', '-q', '-f', 'origin', `HEAD:refs/heads/in/${branch}`);
    return dev('rev-parse', 'HEAD');
  };
  const run = (...args) => {
    const extra = typeof args.at(-1) === 'object' ? args.pop() : {};
    return spawnSync('bash', [join(main, 'tools/brain/inbox.sh'), ...args], {
      cwd: main,
      env: { ...gateEnv, ...extra },
      encoding: 'utf8',
    });
  };
  const runAsync = (...args) =>
    new Promise((done) => {
      const child = spawn('bash', [join(main, 'tools/brain/inbox.sh'), ...args], {
        cwd: main,
        env: gateEnv,
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.on('close', (status) => done({ status, stdout: out }));
    });
  const books = join(dir, 'bto-work/.brain');
  const item = (name) => {
    const file = join(books, 'inbox/items', name);
    return existsSync(file) ? parseRecord(readFileSync(file, 'utf8')) : null;
  };
  const gh = () =>
    existsSync(join(dir, 'gh'))
      ? readFileSync(join(dir, 'gh'), 'utf8').trim().split('\n').filter(Boolean)
      : [];
  const originGit = (...args) => gitIn(origin, env, ...args);
  const hasBranch = (branch) =>
    spawnSync('git', ['show-ref', '-q', '--verify', `refs/heads/${branch}`], { cwd: origin, env })
      .status === 0;
  return {
    dir,
    main,
    books,
    push,
    run,
    runAsync,
    item,
    gh,
    originGit,
    hasBranch,
    dev,
    env: gateEnv,
  };
}

const statusesOf = (lines, head) =>
  lines
    .filter((line) => line.includes(`statuses/${head}`))
    .map((line) => /state=(\w+)/.exec(line)?.[1]);

test('inbox: a LIGHT branch lands at once, keeps its author, and the branch is deleted', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push(
      'orders-label',
      { 'apps/web/src/a.tsx': 'export const a = 2;\n' },
      'feat(web): label',
    );
    const tick = inbox.run('tick');
    assert.equal(tick.status, 0, tick.stderr);
    assert.match(tick.stdout, /LANDED/);
    const item = inbox.item('orders-label');
    assert.equal(item.state, 'LANDED');
    assert.equal(item.class, 'light');
    const landed = inbox.originGit('rev-parse', 'main');
    assert.equal(item.landed, landed);
    assert.equal(
      inbox.originGit('log', '-1', '--format=%an <%ae>', 'main'),
      'Dev Two <dev@example.invalid>',
    );
    const message = inbox.originGit('log', '-1', '--format=%B', 'main');
    assert.match(message, /^feat\(web\): label/);
    assert.match(message, /Inbox-Branch: in\/orders-label\nInbox-Head: [0-9a-f]{40}/);
    assert.equal(inbox.originGit('show', 'main:apps/web/src/a.tsx'), 'export const a = 2;');
    assert.equal(inbox.hasBranch('in/orders-label'), false);
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-orders-label')));
    assert.ok(!existsSync(join(inbox.dir, 'bto-work/in-orders-label')));
    const gh = inbox.gh();
    assert.deepEqual(statusesOf(gh, head), ['success']);
    assert.ok(
      gh.some(
        (line) =>
          line.includes(`commits/${head}/comments`) &&
          line.includes(`LANDED ${landed.slice(0, 8)}`),
      ),
    );
    // Handled once: another tick does nothing.
    inbox.run('tick');
    assert.equal(inbox.gh().length, gh.length);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: several commits become one, their messages in the body', () => {
  const inbox = makeInbox();
  try {
    inbox.push(
      'two',
      { 'apps/web/src/a.tsx': 'export const a = 3;\n' },
      'feat(web): first\n\nwhy it is',
    );
    inbox.push('two', { 'apps/web/src/b.tsx': 'export const b = 3;\n' }, 'fix(web): second', {
      onTop: true,
    });
    const before = inbox.originGit('rev-parse', 'main');
    assert.equal(inbox.run('tick').status, 0);
    assert.equal(inbox.originGit('rev-list', '--count', `${before}..main`), '1');
    const message = inbox.originGit('log', '-1', '--format=%B', 'main');
    assert.match(message, /^feat\(web\): first\n/);
    assert.match(message, /Squashed from in\/two \(2 commits\):/);
    assert.match(message, /\* feat\(web\): first\n\n {2}why it is/);
    assert.match(message, /\* fix\(web\): second/);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a GUARDED branch is checked, waits for review, and lands on approve', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push('sales-rule', {
      'apps/api/src/modules/sales/s.ts': 'export const s = 2;\n',
    });
    const tick = inbox.run('tick');
    assert.equal(tick.status, 0, tick.stderr);
    assert.equal(inbox.item('sales-rule').state, 'WAITING-REVIEW');
    assert.equal(inbox.item('sales-rule').class, 'guarded');
    assert.equal(
      readFileSync(join(inbox.books, 'lanes/in-sales-rule'), 'utf8'),
      'apps/api/src/modules/sales/s.ts\n',
    );
    assert.deepEqual(statusesOf(inbox.gh(), head), ['pending']);
    assert.equal(inbox.originGit('log', '-1', '--format=%s', 'main'), 'start');
    const status = inbox.run('status');
    assert.match(status.stdout, /WAITING-REVIEW {2}in\/sales-rule @ [0-9a-f]{8} {2}GUARDED/);
    assert.match(status.stdout, /suites: bash tools\/brain\/int.sh sales/);
    assert.match(status.stdout, /approve in\/sales-rule/);
    // Ticks leave it alone until the brain decides.
    inbox.run('tick');
    assert.equal(inbox.gh().length, 2);
    const approve = inbox.run('approve', 'in/sales-rule');
    assert.equal(approve.status, 0, approve.stdout + approve.stderr);
    assert.equal(inbox.item('sales-rule').state, 'LANDED');
    assert.equal(
      inbox.originGit('show', 'main:apps/api/src/modules/sales/s.ts'),
      'export const s = 2;',
    );
    assert.deepEqual(statusesOf(inbox.gh(), head), ['pending', 'success']);
    assert.equal(inbox.hasBranch('in/sales-rule'), false);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: reject drops the task and writes the reason back; a new push is a new attempt', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push('rule', { 'apps/api/src/modules/sales/s.ts': 'export const s = 9;\n' });
    inbox.run('tick');
    const reject = inbox.run('reject', 'in/rule', 'money', 'must', 'go', 'through', 'Decimal');
    assert.equal(reject.status, 0, reject.stderr);
    assert.equal(inbox.item('rule').state, 'REFUSED');
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-rule')));
    assert.deepEqual(statusesOf(inbox.gh(), head), ['pending', 'failure']);
    assert.ok(inbox.gh().some((line) => line.includes('money must go through Decimal')));
    assert.equal(inbox.hasBranch('in/rule'), true);
    const again = inbox.push('rule', {
      'apps/api/src/modules/sales/s.ts': 'export const s = 10;\n',
    });
    inbox.run('tick');
    assert.equal(inbox.item('rule').head, again);
    assert.equal(inbox.item('rule').state, 'WAITING-REVIEW');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a new push replaces an attempt that waits for review', () => {
  const inbox = makeInbox();
  try {
    inbox.push('api', { 'apps/api/src/modules/sales/s.ts': 'export const s = 3;\n' });
    inbox.run('tick');
    const second = inbox.push(
      'api',
      { 'apps/api/src/modules/sales/s.ts': 'export const s = 4;\n' },
      'second',
      { onTop: true },
    );
    // The old head can no longer be approved.
    inbox.run('tick');
    assert.equal(inbox.item('api').head, second);
    assert.equal(inbox.item('api').state, 'WAITING-REVIEW');
    assert.equal(inbox.run('approve', 'api').status, 0);
    assert.equal(
      inbox.originGit('show', 'main:apps/api/src/modules/sales/s.ts'),
      'export const s = 4;',
    );
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a guard-rail path is refused at once and only once; nothing opens', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push('sneaky', {
      'apps/web/src/a.tsx': 'export const a = 5;\n',
      'tools/fast-check/check-fast.mjs': "console.log('check:fast green');\n",
    });
    inbox.run('tick');
    const item = inbox.item('sneaky');
    assert.equal(item.state, 'REFUSED');
    assert.match(item.reason, /tools\/fast-check\/check-fast\.mjs: the checks themselves/);
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-sneaky')));
    assert.deepEqual(statusesOf(inbox.gh(), head), ['failure']);
    inbox.run('tick');
    assert.equal(inbox.gh().length, 2);
    assert.equal(inbox.originGit('log', '-1', '--format=%s', 'main'), 'start');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a branch not from main, a bad name and a red check are refused', () => {
  const inbox = makeInbox();
  try {
    inbox.dev('checkout', '-q', '--orphan', 'alien');
    inbox.dev('rm', '-rq', '--cached', '.');
    writeFileSync(join(inbox.dir, 'dev/alien.txt'), 'x\n');
    inbox.dev('add', 'alien.txt');
    inbox.dev('commit', '-q', '-m', 'alien');
    inbox.dev('push', '-q', 'origin', 'HEAD:refs/heads/in/alien');
    inbox.dev('checkout', '-q', '-f', 'main');
    inbox.dev('clean', '-fdq');
    inbox.push('Bad_Name', { 'apps/web/src/a.tsx': 'export const a = 6;\n' });
    writeFileSync(join(inbox.dir, 'red'), '');
    inbox.push('red-page', { 'apps/web/src/b.tsx': 'export const b = 6;\n' });
    inbox.run('tick');
    assert.match(inbox.item('alien').reason, /not on top of a commit of main's history/);
    assert.match(inbox.item('Bad_Name').reason, /the branch is in\/<slug>/);
    assert.equal(inbox.item('red-page').state, 'REFUSED');
    assert.match(inbox.item('red-page').reason, /check:fast is red: .*TS2322/);
    // GitHub (a public repository) gets the step's name, never the output or a local path.
    const told = inbox.gh().filter((line) => line.includes(inbox.item('red-page').head));
    assert.ok(told.length > 0);
    for (const line of told) {
      assert.doesNotMatch(line, /TS2322|\/home\//);
    }
    assert.ok(told.some((line) => line.includes("red (web types); details in the gate's log")));
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-red-page')));
    assert.ok(!existsSync(join(inbox.dir, 'bto-work/in-red-page')));
    assert.equal(inbox.originGit('log', '-1', '--format=%s', 'main'), 'start');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a path a running task holds waits, then lands by itself', () => {
  const inbox = makeInbox();
  try {
    mkdirSync(join(inbox.books, 'lanes'), { recursive: true });
    writeFileSync(join(inbox.books, 'lanes/brain-task'), 'apps/web/src\n');
    const head = inbox.push('page', { 'apps/web/src/a.tsx': 'export const a = 7;\n' });
    inbox.run('tick');
    assert.equal(inbox.item('page').state, 'WAITING');
    assert.match(inbox.item('page').reason, /held by brain-task/);
    inbox.run('tick');
    assert.deepEqual(statusesOf(inbox.gh(), head), ['pending']);
    rmSync(join(inbox.books, 'lanes/brain-task'));
    inbox.run('tick');
    assert.equal(inbox.item('page').state, 'LANDED');
    assert.deepEqual(statusesOf(inbox.gh(), head), ['pending', 'success']);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a branch that no longer fits on main is sent back to rebase', () => {
  const inbox = makeInbox();
  try {
    const base = inbox.originGit('rev-parse', 'main');
    inbox.push('first', { 'apps/web/src/a.tsx': 'export const a = "first";\n' });
    inbox.run('tick');
    assert.equal(inbox.item('first').state, 'LANDED');
    inbox.push('second', { 'apps/web/src/a.tsx': 'export const a = "second";\n' }, 'x', {
      from: base,
    });
    inbox.run('tick');
    assert.equal(inbox.item('second').state, 'REFUSED');
    assert.match(
      inbox.item('second').reason,
      /conflicts with main: rebase onto main \(apps\/web\/src\/a\.tsx\)/,
    );
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-second')));
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a dry run says what it would do and changes nothing', () => {
  const inbox = makeInbox();
  try {
    inbox.push('light', { 'apps/web/src/a.tsx': 'export const a = 8;\n' });
    inbox.push('guarded', { 'apps/api/src/db/migrations/0300_x.sql': 'select 1;\n' });
    inbox.push('rails', { 'deploy/store/setup.sh': 'echo\n' });
    const dry = inbox.run('tick', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /in\/light @ [0-9a-f]{8}\n.*\n {2}would LIGHT: open task in-light/);
    assert.match(
      dry.stdout,
      /would GUARDED: open task in-guarded[^\n]*\n.*0300_x\.sql\n {4}migration: /,
    );
    assert.match(dry.stdout, /would REFUSE: guard rails:\n {4}deploy\/store\/setup\.sh: /);
    assert.deepEqual(inbox.gh(), []);
    assert.deepEqual(readdirSync(join(inbox.books, 'inbox/items')), []);
    assert.deepEqual(readdirSync(join(inbox.books, 'lanes')), []);
    assert.equal(inbox.originGit('log', '-1', '--format=%s', 'main'), 'start');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: two ticks at once land a branch once', async () => {
  const inbox = makeInbox();
  try {
    inbox.push('once', { 'apps/web/src/a.tsx': 'export const a = 9;\n' });
    const before = inbox.originGit('rev-parse', 'main');
    const ticks = await Promise.all([inbox.runAsync('tick'), inbox.runAsync('tick')]);
    assert.deepEqual(
      ticks.map((tick) => tick.status),
      [0, 0],
    );
    assert.equal(ticks.filter((tick) => tick.stdout.includes('LANDED')).length, 1);
    assert.equal(inbox.originGit('rev-list', '--count', `${before}..main`), '1');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('monitor: an inbox record is shown without its files or the whole check output', () => {
  const long = `pnpm check:fast is red: ${'x'.repeat(400)}`;
  const item = parseInboxItem(
    [
      'branch=in/orders-label',
      `head=${'a'.repeat(40)}`,
      'state=REFUSED',
      'class=light',
      'files=apps/web/src/a.tsx packages/shared/i18n/mn.json',
      `reason=${long}`,
      'updated=1790000000',
    ].join('\n'),
  );
  assert.equal(item.branch, 'in/orders-label');
  assert.equal(item.head, 'aaaaaaaa');
  assert.equal(item.kind, 'light');
  assert.equal(item.files, 2);
  assert.equal(item.reason.length, 160);
  assert.equal(item.updatedAt, 1790000000000);
  assert.equal(parseInboxItem('state=LANDED'), null);
});

test('inbox: branches of another remote are only ever looked at (land.sh pushes to origin)', () => {
  const work = mkdtempSync(join(tmpdir(), 'bto-inbox-remote-'));
  try {
    const run = spawnSync('bash', [inboxScript, 'tick'], {
      env: { ...process.env, BTO_WORK: work, BTO_INBOX_REMOTE: join(work, 'fake.git') },
      encoding: 'utf8',
    });
    assert.equal(run.status, 64);
    assert.match(run.stderr, /for a dry run only/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('inbox: non-ASCII and quoted names are read as they are, so the guard rails hold', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push('accents', {
      'apps/web/src/a.tsx': 'export const a = 11;\n',
      'deploy/é.sh': 'echo\n',
      'tools/brain/ü.sh': 'echo\n',
    });
    inbox.push('quote', { 'apps/web/src/q"x.tsx': 'export const q = 1;\n' });
    inbox.run('tick');
    const item = inbox.item('accents');
    assert.equal(item.state, 'REFUSED');
    assert.match(item.reason, /deploy\/é\.sh: the gate, the deploy and CI/);
    assert.match(item.reason, /tools\/brain\/ü\.sh: the gate, the deploy and CI/);
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-accents')));
    assert.deepEqual(statusesOf(inbox.gh(), head), ['failure']);
    assert.equal(inbox.item('quote').state, 'REFUSED');
    assert.match(inbox.item('quote').reason, /a file name with a quote/);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a non-ASCII page is held and landed under its real name', () => {
  const inbox = makeInbox();
  try {
    inbox.push('umlaut', { 'apps/web/src/ünï.tsx': 'export const u = 1;\n' });
    inbox.run('tick');
    assert.equal(inbox.item('umlaut').state, 'LANDED');
    assert.equal(inbox.originGit('show', 'main:apps/web/src/ünï.tsx'), 'export const u = 1;');
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test("inbox: a tick killed after opening the task is recovered: the gate's task dropped, tried again", () => {
  const inbox = makeInbox();
  try {
    inbox.push('crash-open', { 'apps/web/src/a.tsx': 'export const a = 12;\n' });
    const killed = inbox.run('tick', { BTO_INBOX_DIE_AT: 'opened' });
    assert.notEqual(killed.status, 0);
    assert.equal(inbox.item('crash-open').phase, 'open');
    assert.equal(inbox.item('crash-open').state, 'WAITING');
    assert.ok(existsSync(join(inbox.books, 'lanes/in-crash-open')));
    assert.match(inbox.run('status').stdout, /INTERRUPTED {2}in\/crash-open/);
    assert.deepEqual(inbox.gh(), []);
    const tick = inbox.run('tick');
    assert.equal(tick.status, 0, tick.stderr);
    assert.match(tick.stdout, /recovering/);
    assert.equal(inbox.item('crash-open').state, 'LANDED');
    assert.equal(inbox.originGit('show', 'main:apps/web/src/a.tsx'), 'export const a = 12;');
    assert.ok(!existsSync(join(inbox.books, 'lanes/in-crash-open')));
    assert.ok(!existsSync(join(inbox.books, 'owners/in-crash-open')));
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: a tick killed after land.sh pushed finishes as LANDED: reported once, branch deleted', () => {
  const inbox = makeInbox();
  try {
    const head = inbox.push('crash-land', { 'apps/web/src/b.tsx': 'export const b = 12;\n' });
    const killed = inbox.run('tick', { BTO_INBOX_DIE_AT: 'landed' });
    assert.notEqual(killed.status, 0);
    const landed = inbox.originGit('rev-parse', 'main');
    assert.match(
      inbox.originGit('log', '-1', '--format=%B', 'main'),
      new RegExp(`Inbox-Head: ${head}`),
    );
    assert.equal(inbox.item('crash-land').phase, 'land');
    assert.equal(inbox.hasBranch('in/crash-land'), true);
    assert.deepEqual(inbox.gh(), []);
    const tick = inbox.run('tick');
    assert.equal(tick.status, 0, tick.stderr);
    assert.equal(inbox.item('crash-land').state, 'LANDED');
    assert.equal(inbox.item('crash-land').landed, landed);
    assert.equal(inbox.originGit('rev-parse', 'main'), landed);
    assert.deepEqual(statusesOf(inbox.gh(), head), ['success']);
    assert.equal(inbox.hasBranch('in/crash-land'), false);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});

test('inbox: an in-* copy the gate did not open is never dropped, and task.sh keeps in-* for the gate', () => {
  const inbox = makeInbox();
  try {
    const taskSh = join(inbox.main, 'tools/brain/task.sh');
    const refused = spawnSync('bash', [taskSh, 'new', 'in-mine', 'apps/web/src/b.tsx'], {
      cwd: inbox.main,
      env: inbox.env,
      encoding: 'utf8',
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /in-\* are the inbox gate's/);
    // Someone's own copy named in-page, with uncommitted work, made outside the gate.
    const copy = join(inbox.dir, 'bto-work/in-page');
    spawnSync('git', ['worktree', 'add', '-q', '-b', 'task/in-page', copy, 'origin/main'], {
      cwd: inbox.main,
      env: inbox.env,
    });
    writeFileSync(join(copy, 'apps/web/src/a.tsx'), 'my unsaved work\n');
    const head = inbox.push('page', { 'apps/web/src/b.tsx': 'export const b = 13;\n' });
    inbox.run('tick');
    assert.equal(inbox.item('page').state, 'WAITING');
    assert.match(inbox.item('page').reason, /could not open a task/);
    inbox.push('page', { 'apps/web/src/b.tsx': 'export const b = 14;\n' }, 'again', {
      onTop: true,
    });
    inbox.run('tick');
    assert.equal(inbox.run('retry', 'in/page').status, 0);
    inbox.run('tick');
    assert.equal(readFileSync(join(copy, 'apps/web/src/a.tsx'), 'utf8'), 'my unsaved work\n');
    const told = inbox.gh().filter((line) => line.includes(head));
    for (const line of told) assert.doesNotMatch(line, /bto-work|\/tmp\//);
  } finally {
    rmSync(inbox.dir, { recursive: true, force: true });
  }
});
