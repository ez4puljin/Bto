// The brain's monitor (owner 2026-11-20: «Тархи болон тархины удирдаж буй agents хянах UI дэлгэц
// надад хэрэгтэй байна»): http://<this PC>:3310 on the store's LAN shows, refreshing by itself, what
// the brain (ADR-0213, tools/brain/README.md) is doing: the open tasks and what they hold, the
// workers running or finished, the landings and whether the real system runs them, the code graph,
// the inbox gate's branches (ADR-0242) and the team board (ADR-0248): who holds what on each side,
// the numbers handed out and the last messages between the two developers' AIs.
//
// Read-only. It reads the brain's books (~/bto-work/.brain), the task copies (git), Claude Code's
// subagent transcripts (~/.claude/projects/*/<session>/subagents), the real system's /health and
// the auto-deploy log; it writes nothing anywhere, except that it fetches the team board's branch
// into the board's own clone at most once a minute (board.mjs sync). The page is open to the whole LAN, so a worker
// shows only its description, task, type, model, times, the name of its last tool call, one line of
// its last text and its tokens: never a tool's input or output, a file's content, or the brief.
// Not published outside the LAN (CLAUDE.md: nothing new goes through the tunnel without a decision).
//
//   node tools/brain/monitor/serve.mjs          (BRAIN_MONITOR_PORT, default 3310, on 0.0.0.0)
//   systemd user unit: bto-brain-monitor.service (installed by tools/brain/install.sh)
// No dependency.
import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoard } from '../board.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const WORK = process.env.BTO_WORK ?? path.join(HOME, 'bto-work');
const STATE = path.join(WORK, '.brain');
const BASE_REF = process.env.BTO_BASE_REF ?? 'origin/main';
const PROJECTS = path.join(HOME, '.claude', 'projects');
const DEPLOY_LOG = path.join(HOME, '.local', 'state', 'bto-deploy', 'auto-deploy.log');
const HEALTH_URL = 'http://127.0.0.1/health';

const MINUTE = 60_000;
/** A worker whose transcript was written this recently is running. */
export const RUNNING_WINDOW = 10 * MINUTE;
/** Workers older than this are not shown (unless still running). */
const SHOWN_DAYS = 7;
const LANDINGS_SHOWN = 15;
/** One line of a worker's text, at most this long. */
const TEXT_CUT = 160;
/** A transcript is read in pieces of at most this many bytes. */
const CHUNK = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Pure functions (tools/brain/brain.test.mjs)
// ---------------------------------------------------------------------------------------------

/** The paths a task holds: one per line of `lanes/<slug>`. */
export function parseLane(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** States of the inbox gate (ADR-0242) that still wait for something. */
export const INBOX_OPEN = new Set(['WAITING', 'WAITING-REVIEW']);
const INBOX_SHOWN = 10;
const BOARD_STATE = path.join(STATE, 'board');
const BOARD_MESSAGES_SHOWN = 10;
const BOARD_NUMBERS_SHOWN = 12;
const BOARD_SYNC_EVERY = MINUTE;

/**
 * One record of the inbox gate (`inbox/items/<key>`, key=value lines; tools/brain/inbox.sh), as the
 * page shows it: the branch, its head, the state and class, how many files, one cut line of why.
 */
export function parseInboxItem(text) {
  const record = {};
  for (const line of String(text).split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) record[line.slice(0, at)] = line.slice(at + 1);
  }
  if (!record.branch || !record.state) return null;
  const epoch = (value) => (/^\d+$/.test(value ?? '') ? Number.parseInt(value, 10) * 1000 : null);
  const reason = (record.reason ?? '').trim();
  return {
    branch: record.branch,
    head: (record.head ?? '').slice(0, 8),
    state: record.state,
    kind: record.class || null,
    files: (record.files ?? '').split(' ').filter(Boolean).length,
    reason: reason.length > TEXT_CUT ? `${reason.slice(0, TEXT_CUT - 1)}…` : reason,
    landed: record.landed ? record.landed.slice(0, 8) : null,
    task: record.task || null,
    updatedAt: epoch(record.updated) ?? epoch(record.started),
    // The automatic review (ADR-0249): what it decided, with which model, how long it took, and one
    // cut line of why (never the review's text, which stays in the state folder).
    review: record.review
      ? {
          state: record.review,
          why: cut(record.review_why ?? ''),
          model: record.review_model || null,
          secs: /^\d+$/.test(record.review_secs ?? '')
            ? Number.parseInt(record.review_secs, 10)
            : null,
        }
      : null,
    wording: Boolean(record.wording),
  };
}

function cut(text) {
  const t = String(text).trim();
  return t.length > TEXT_CUT ? `${t.slice(0, TEXT_CUT - 1)}…` : t;
}

/** A local «YYYY-MM-DD HH:MM:SS» (this PC's time zone) as epoch milliseconds, or null. */
function localTime(date, time) {
  const at = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(at) ? at : null;
}

/** One line of the landing log: `YYYY-MM-DD HH:MM:SS <sha8> <slug>…`, or null. */
export function parseLandingLine(line) {
  const m =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([0-9a-f]{7,40})((?: [a-z0-9][a-z0-9-]*)+)\s*$/.exec(
      String(line).trim(),
    );
  if (!m) return null;
  const at = localTime(m[1], m[2]);
  if (at === null) return null;
  return { at, sha: m[3], slugs: m[4].trim().split(/\s+/) };
}

/**
 * One line of the auto-deploy log (deploy/store, ADR-0204), or null for a line about no commit.
 * kind: started | live | moved | waiting | refused | ci-green | ci-red | ci-red-stuck | ci-cancelled
 */
export function parseDeployLine(line) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (.*)$/.exec(String(line).trim());
  if (!m) return null;
  const at = localTime(m[1], m[2]);
  const text = m[3];
  if (at === null) return null;
  const rules = [
    [/^CI ногоон: ([0-9a-f]{7,40})/, 'ci-green'],
    [/^CI улаан: ([0-9a-f]{7,40}), БУЦААЖ ЧАДСАНГҮЙ/, 'ci-red-stuck'],
    [/^CI улаан: ([0-9a-f]{7,40})/, 'ci-red'],
    [/^CI ([0-9a-f]{7,40})-ийг шинэ push/, 'ci-cancelled'],
    [/^([0-9a-f]{7,40}): тавьж эхэллээ/, 'started'],
    [/^([0-9a-f]{7,40}): ажиллаж байна/, 'live'],
    [/^([0-9a-f]{7,40}): зөвхөн баримт бичиг/, 'moved'],
    [/^([0-9a-f]{7,40}): migration-тэй тул CI ногоон болохыг хүлээж/, 'waiting'],
    [/^([0-9a-f]{7,40}): CI улаан тул тавихгүй/, 'refused'],
  ];
  for (const [re, kind] of rules) {
    const hit = re.exec(text);
    if (hit) return { at, sha: hit[1], kind, text };
  }
  return { at, sha: null, kind: 'other', text };
}

const sameSha = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));

/**
 * Whether a landing runs on the real system, from the deploy log's lines about its commit, the
 * running version and whether the landing's commit is in that version (git, done by the caller).
 *   state: live | deploying | waiting | rolled-back | stuck | refused | pending
 *   ci:    green | red | cancelled | null (not known)
 */
export function landingState(sha, events, running, inRunning) {
  const own = events.filter((e) => sameSha(e.sha, sha));
  const has = (kind) => own.some((e) => e.kind === kind);
  const ci = has('ci-green')
    ? 'green'
    : has('ci-red') || has('ci-red-stuck')
      ? 'red'
      : has('ci-cancelled')
        ? 'cancelled'
        : null;
  let state = 'pending';
  if (sameSha(running, sha) || inRunning) state = 'live';
  else if (has('ci-red-stuck')) state = 'stuck';
  else if (has('ci-red')) state = 'rolled-back';
  else if (has('moved')) state = 'live';
  else if (has('refused')) state = 'refused';
  else if (has('waiting') && !has('started')) state = 'waiting';
  else if (has('started')) state = 'deploying';
  return { state, ci };
}

/** The code graph's last update from `graph/update.log`: idle, running, stale (a start never ended) or failed. */
export function parseGraphLog(text, now) {
  const marks = String(text)
    .split('\n')
    .filter((line) => line.startsWith('== '));
  const last = marks.at(-1);
  if (!last) return { state: 'none', at: null, seconds: null };
  const done = /^== (ok|FAILED) in (\d+) s/.exec(last);
  const started = (line) => {
    const m = /^== (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([0-9a-f]+)/.exec(line ?? '');
    return m ? { at: localTime(m[1], m[2]), sha: m[3] } : null;
  };
  if (done) {
    const start = started(marks.at(-2));
    return {
      state: done[1] === 'ok' ? 'idle' : 'failed',
      at: start?.at ?? null,
      sha: start?.sha ?? null,
      seconds: Number.parseInt(done[2], 10),
    };
  }
  const start = started(last);
  if (!start) return { state: 'none', at: null, seconds: null };
  const stale = start.at !== null && now - start.at > 30 * MINUTE;
  return { state: stale ? 'stale' : 'running', at: start.at, sha: start.sha, seconds: null };
}

/** The task a brief is for: its `Copy: ~/bto-work/<slug>` line. Nothing else of the brief is kept. */
export function slugFromBrief(brief) {
  const m =
    /Copy:\s*(?:~|\$HOME|\/home\/[^/\s]+)\/bto-work\/([a-z0-9][a-z0-9-]{1,40})(?![a-z0-9-])/.exec(
      String(brief ?? ''),
    );
  return m && m[1] !== '_gate' ? m[1] : null;
}

/** One line of a worker's text: the `What changed:` of a report, else its last line, cut short. */
export function lastTextLine(text) {
  const lines = String(text)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[#>*-]+\s*)+/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line && !/^`{3,}/.test(line));
  const changed = lines.find((line) => /^What changed:/i.test(line));
  const line = changed ?? lines.at(-1) ?? '';
  return line.length > TEXT_CUT ? `${line.slice(0, TEXT_CUT - 1)}…` : line;
}

/** The `RESULT:` of a worker's report (DONE, BLOCKED or NEED), or null. */
export function resultOf(text) {
  const m = /^\s*RESULT:\s*(DONE|BLOCKED|NEED)\b/m.exec(String(text));
  return m ? m[1] : null;
}

/** An empty summary of a transcript; `feedTranscript` fills it line by line. */
export function newSummary() {
  return {
    lines: 0,
    slug: null,
    startedAt: null,
    lastAt: null,
    model: null,
    lastTool: null,
    lastText: null,
    result: null,
    usage: new Map(),
  };
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((block) => block?.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n')
      : '';

/** Adds whole lines of a transcript to a summary; a line that is not JSON or of an unknown type is skipped. */
export function feedTranscript(summary, lines) {
  for (const raw of lines) {
    if (!raw.trim()) continue;
    summary.lines += 1;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const at = Date.parse(entry.timestamp ?? '');
    if (entry.type === 'user' && summary.startedAt === null) {
      // The brief: only the task's name is taken from it.
      summary.slug = slugFromBrief(textOf(entry.message?.content));
      if (Number.isFinite(at)) summary.startedAt = at;
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (Number.isFinite(at)) {
      summary.startedAt ??= at;
      summary.lastAt = Math.max(summary.lastAt ?? at, at);
    }
    if (entry.type !== 'assistant') continue;
    const message = entry.message ?? {};
    if (typeof message.model === 'string' && !message.model.startsWith('<'))
      summary.model = message.model;
    const usage = message.usage;
    if (usage && typeof usage === 'object') {
      // One reply is written as several lines (one per block), each with the same usage: count it once.
      const key = message.id ?? entry.requestId ?? entry.uuid ?? `line-${summary.lines}`;
      summary.usage.set(key, {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      });
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'tool_use' && typeof block.name === 'string')
        summary.lastTool = block.name;
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        summary.lastText = lastTextLine(block.text);
        summary.result = resultOf(block.text);
      }
    }
  }
  return summary;
}

/** Summed tokens of a summary. */
export function tokensOf(summary) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const usage of summary.usage.values()) {
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
  }
  total.total = total.input + total.output + total.cacheRead + total.cacheWrite;
  return total;
}

/** A whole transcript's text summarised; a half-written last line is skipped. */
export function summarizeTranscript(text) {
  return feedTranscript(newSummary(), String(text).split('\n'));
}

/** running: still working; finished; stalled: not finished but silent for longer than the window. */
export function workerStatus(meta, lastWrite, now) {
  if (meta?.finished === true) return 'finished';
  return now - lastWrite <= RUNNING_WINDOW ? 'running' : 'stalled';
}

/** Whether a worker belongs on the monitor: a Bto worker type, or another agent given a task's copy. */
export function isBrainWorker(meta, slug) {
  return String(meta?.agentType ?? '').startsWith('bto-') || Boolean(slug);
}

// ---------------------------------------------------------------------------------------------
// Gathering: every source on its own, a missing or half-written file skipped
// ---------------------------------------------------------------------------------------------

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 1024 * 1024, ...options }, (error, stdout) =>
      resolve(error ? null : stdout),
    );
  });
}

const git = (dir, ...args) => run('git', ['-C', dir, ...args]);
const readText = (file) => readFile(file, 'utf8').catch(() => null);
const statOf = (file) => stat(file).catch(() => null);

/** The main checkout, as lib.sh finds it: where the repository's .git directory is. */
let mainDir = null;
async function main() {
  if (mainDir) return mainDir;
  const common = await git(HERE, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  mainDir = common ? path.dirname(common.trim()) : path.join(HOME, 'bto-dev');
  return mainDir;
}

// Answers of `git merge-base --is-ancestor` that cannot change: a commit once in a version stays in it.
const ancestry = new Map();
async function isAncestor(sha, of) {
  if (!sha || !of) return false;
  const key = `${sha} ${of}`;
  if (ancestry.has(key)) return ancestry.get(key);
  const repo = await main();
  const yes = await new Promise((resolve) => {
    execFile(
      'git',
      ['-C', repo, 'merge-base', '--is-ancestor', sha, of],
      { timeout: 5000 },
      (error) => resolve(!error),
    );
  });
  if (yes) ancestry.set(key, true);
  return yes;
}

async function gatherTasks() {
  const repo = await main();
  const lanesDir = path.join(STATE, 'lanes');
  const names = await readdir(lanesDir).catch(() => []);
  const tasks = await Promise.all(
    names
      .filter((name) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(name))
      .map(async (slug) => {
        const paths = parseLane((await readText(path.join(lanesDir, slug))) ?? '');
        const copy = path.join(WORK, slug);
        const exists = Boolean(await statOf(copy));
        const lane = await statOf(path.join(lanesDir, slug));
        let ahead = null;
        let dirty = null;
        if (exists) {
          const count = await git(repo, 'rev-list', '--count', `${BASE_REF}..task/${slug}`);
          ahead = count === null ? null : Number.parseInt(count.trim(), 10);
          const status = await git(copy, 'status', '--porcelain');
          dirty = status === null ? null : status.split('\n').filter(Boolean).length;
        }
        return {
          slug,
          paths,
          exists,
          ahead,
          dirty,
          openedAt: lane?.birthtimeMs || lane?.mtimeMs || null,
        };
      }),
  );
  return tasks.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
}

/** Reads the bytes of a file from an offset up to its last whole line. */
function readWholeLines(file, from, size) {
  const fd = openSync(file, 'r');
  try {
    const lines = [];
    let offset = from;
    let rest = Buffer.alloc(0);
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const buffer = Buffer.alloc(length);
      const read = readSync(fd, buffer, 0, length, offset);
      if (read <= 0) break;
      offset += read;
      const joined = Buffer.concat([rest, buffer.subarray(0, read)]);
      const end = joined.lastIndexOf(0x0a);
      if (end < 0) {
        rest = joined;
        continue;
      }
      lines.push(...joined.subarray(0, end).toString('utf8').split('\n'));
      rest = joined.subarray(end + 1);
    }
    return { lines, consumed: offset - rest.length };
  } finally {
    closeSync(fd);
  }
}

// Transcripts are read once and then only what was added: file → { ino, offset, summary }.
const transcripts = new Map();
function summaryOf(file, info) {
  let cached = transcripts.get(file);
  if (!cached || cached.ino !== info.ino || info.size < cached.offset) {
    cached = { ino: info.ino, offset: 0, summary: newSummary() };
    transcripts.set(file, cached);
  }
  if (info.size > cached.offset) {
    const { lines, consumed } = readWholeLines(file, cached.offset, info.size);
    feedTranscript(cached.summary, lines);
    cached.offset = consumed;
  }
  return cached.summary;
}

const metas = new Map();
async function metaOf(file) {
  const info = await statOf(file);
  if (!info) return null;
  const cached = metas.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.meta;
  try {
    const meta = JSON.parse(await readFile(file, 'utf8'));
    metas.set(file, { mtimeMs: info.mtimeMs, size: info.size, meta });
    return meta;
  } catch {
    return cached?.meta ?? null; // half-written: the last good one
  }
}

/** The model of a brain session: the last assistant line in the tail of its transcript. */
async function sessionModel(file, size) {
  const fd = openSync(file, 'r');
  try {
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"type":"assistant"')) continue;
      try {
        const model = JSON.parse(line).message?.model;
        if (typeof model === 'string' && !model.startsWith('<')) return model;
      } catch {
        // a line cut by the tail's start
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Where a session ran, from Claude Code's project folder name (its path with «/» as «-»). */
function placeOf(project) {
  const home = HOME.replace(/[^A-Za-z0-9]/g, '-');
  if (project === home) return '~';
  return project.startsWith(`${home}-`) ? `~/${project.slice(home.length + 1)}` : project;
}

async function gatherWorkers(now) {
  const since = now - SHOWN_DAYS * 24 * 60 * MINUTE;
  const workers = [];
  const sessions = new Map();
  const projects = await readdir(PROJECTS).catch(() => []);
  for (const project of projects) {
    const projectDir = path.join(PROJECTS, project);
    const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(projectDir, entry.name);
      const agentsDir = path.join(sessionDir, 'subagents');
      const files = await readdir(agentsDir).catch(() => []);
      for (const name of files) {
        const m = /^agent-([A-Za-z0-9]+)\.jsonl$/.exec(name);
        if (!m) continue;
        try {
          const file = path.join(agentsDir, name);
          const info = await statOf(file);
          if (!info) continue;
          const meta = await metaOf(path.join(agentsDir, `agent-${m[1]}.meta.json`));
          if (!meta) continue;
          const status = workerStatus(meta, info.mtimeMs, now);
          if (info.mtimeMs < since && status !== 'running') continue;
          // Only Bto workers are read; a fallback worker (general-purpose) shows when its brief names a copy.
          const bto = String(meta.agentType ?? '').startsWith('bto-');
          if (!bto && meta.agentType !== 'general-purpose') continue;
          const summary = summaryOf(file, info);
          if (!isBrainWorker(meta, summary.slug)) continue;
          const startedAt = summary.startedAt ?? info.birthtimeMs ?? null;
          const lastAt = Math.max(summary.lastAt ?? 0, info.mtimeMs);
          workers.push({
            id: m[1],
            session: entry.name,
            type: meta.agentType ?? null,
            description:
              typeof meta.description === 'string' ? meta.description.slice(0, 120) : null,
            model: summary.model ?? meta.model ?? meta.pickedEffortModel ?? null,
            slug: summary.slug,
            status,
            startedAt,
            lastAt,
            durationMs: startedAt ? lastAt - startedAt : null,
            lastTool: summary.lastTool,
            lastText: summary.lastText,
            result: summary.result,
            tokens: tokensOf(summary),
          });
          if (!sessions.has(entry.name)) sessions.set(entry.name, { project, dir: sessionDir });
        } catch {
          // a file that went away or could not be read: left out of this round
        }
      }
    }
  }
  workers.sort(
    (a, b) =>
      Number(b.status === 'running') - Number(a.status === 'running') || b.lastAt - a.lastAt,
  );

  const brainSessions = [];
  for (const [id, { project, dir }] of sessions) {
    const file = `${dir}.jsonl`;
    const info = await statOf(file);
    let title = null;
    try {
      const custom = JSON.parse(await readFile(path.join(dir, 'custom-title.json'), 'utf8'));
      if (typeof custom.customTitle === 'string') title = custom.customTitle.slice(0, 80);
    } catch {
      // no title
    }
    const own = workers.filter((w) => w.session === id);
    const lastAt = Math.max(info?.mtimeMs ?? 0, ...own.map((w) => w.lastAt));
    brainSessions.push({
      id,
      place: placeOf(project),
      title,
      model: info ? await sessionModel(file, info.size).catch(() => null) : null,
      lastAt,
      active: info ? now - info.mtimeMs <= RUNNING_WINDOW : false,
      workers: own.map((w) => w.id),
    });
  }
  brainSessions.sort((a, b) => b.lastAt - a.lastAt);
  return { workers, sessions: brainSessions };
}

async function gatherRunning() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return {
      ok: response.ok && body?.status === 'ok',
      version: typeof body?.version === 'string' ? body.version : null,
    };
  } catch {
    return { ok: false, version: null };
  }
}

/** The last lines of a file, without reading all of it. */
async function tail(file, bytes) {
  const info = await statOf(file);
  if (!info) return [];
  const fd = openSync(file, 'r');
  try {
    const length = Math.min(info.size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, info.size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < info.size) lines.shift(); // cut by the start of the tail
    return lines.filter(Boolean);
  } finally {
    closeSync(fd);
  }
}

async function gatherLandings(running) {
  const lines = await tail(path.join(STATE, 'log'), 64 * 1024);
  const landings = lines.map(parseLandingLine).filter(Boolean).slice(-LANDINGS_SHOWN).reverse();
  const events = (await tail(DEPLOY_LOG, 256 * 1024)).map(parseDeployLine).filter(Boolean);
  const out = [];
  for (const landing of landings) {
    const inRunning = running.version ? await isAncestor(landing.sha, running.version) : false;
    out.push({ ...landing, ...landingState(landing.sha, events, running.version, inRunning) });
  }
  const deploy = events
    .slice(-6)
    .reverse()
    .map(({ at, kind, text }) => ({ at, kind, text }));
  return { landings: out, deploy };
}

async function gatherGraph(now) {
  const dir = path.join(STATE, 'graph');
  const repo = await main();
  const commit = (await readText(path.join(dir, 'commit')))?.trim() || null;
  const built = await statOf(path.join(dir, 'commit'));
  const graph = await statOf(path.join(dir, 'src', 'graphify-out', 'graph.json'));
  const update = parseGraphLog(
    (await tail(path.join(dir, 'update.log'), 64 * 1024)).join('\n'),
    now,
  );
  if (!commit) return { commit: null, update };
  const [subject, behind] = await Promise.all([
    git(repo, 'log', '-1', '--format=%s', commit),
    git(repo, 'rev-list', '--count', `${commit}..${BASE_REF}`),
  ]);
  return {
    commit: commit.slice(0, 8),
    subject: subject?.trim().slice(0, 120) ?? null,
    builtAt: built?.mtimeMs ?? null,
    behind: behind === null ? null : Number.parseInt(behind.trim(), 10),
    sizeBytes: graph?.size ?? null,
    update,
  };
}

/** The inbox gate: what waits, then the newest results. */
async function gatherInbox() {
  const dir = path.join(STATE, 'inbox', 'items');
  const names = await readdir(dir).catch(() => []);
  const items = (
    await Promise.all(
      names.map(async (name) => parseInboxItem((await readText(path.join(dir, name))) ?? '')),
    )
  ).filter(Boolean);
  items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const open = items.filter((item) => INBOX_OPEN.has(item.state));
  const done = items.filter((item) => !INBOX_OPEN.has(item.state)).slice(0, INBOX_SHOWN);
  return [...open, ...done];
}

/**
 * The team board as the page shows it: claims by side, the newest numbers, the last messages
 * (newest first). `fetchedAt` is when this PC last reached it.
 */
export function boardView(board, fetchedAt) {
  const sides = new Map();
  for (const c of board.claims) {
    if (!sides.has(c.who)) sides.set(c.who, []);
    sides
      .get(c.who)
      .push({ slug: c.slug, paths: c.paths, what: c.what ?? '', since: c.since ?? null });
  }
  return {
    tip: board.tip ? board.tip.slice(0, 8) : null,
    fetchedAt,
    sides: [...sides].map(([who, claims]) => ({ who, claims })),
    numbers: [...board.numbers]
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || b.number - a.number)
      .slice(0, BOARD_NUMBERS_SHOWN)
      .map((n) => ({
        kind: n.kind,
        number: String(n.number).padStart(4, '0'),
        who: n.who,
        slug: n.slug,
      })),
    messages: board.messages
      .slice(-BOARD_MESSAGES_SHOWN)
      .reverse()
      .map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        at: m.at,
        text: m.text,
        slug: m.slug ?? null,
      })),
  };
}

let boardSynced = 0;
async function gatherBoard() {
  const gitDir = path.join(BOARD_STATE, 'repo.git');
  if (!(await statOf(path.join(gitDir, 'HEAD')))) return null;
  if (Date.now() - boardSynced > BOARD_SYNC_EVERY) {
    boardSynced = Date.now();
    // In the background: this gathering shows the last fetched board.
    run(process.execPath, [path.join(HERE, '..', 'board.mjs'), 'sync', '--state', BOARD_STATE], {
      timeout: 20_000,
    });
  }
  const fetched = (await readText(path.join(BOARD_STATE, 'fetched')))?.trim();
  return boardView(readBoard({ gitDir }), fetched ? Date.parse(fetched) : null);
}

/** Each part on its own: one that fails is named in `errors`, the rest is still shown. */
async function gather() {
  const now = Date.now();
  const errors = [];
  const part = (name, promise, fallback) =>
    promise.catch((error) => {
      errors.push(name);
      console.error(`brain-monitor: ${name}: ${error?.message ?? error}`);
      return fallback;
    });
  const running = await gatherRunning();
  const [tasks, people, landed, graph, inbox, board] = await Promise.all([
    part('tasks', gatherTasks(), []),
    part('workers', gatherWorkers(now), { workers: [], sessions: [] }),
    part('landings', gatherLandings(running), { landings: [], deploy: [] }),
    part('graph', gatherGraph(now), null),
    part('inbox', gatherInbox(), []),
    part('board', gatherBoard(), null),
  ]);
  const newest = new Map();
  for (const w of people.workers) if (w.slug && !newest.has(w.slug)) newest.set(w.slug, w.id);
  return {
    now,
    running,
    tasks: tasks.map((t) => ({ ...t, worker: newest.get(t.slug) ?? null })),
    workers: people.workers,
    sessions: people.sessions,
    landings: landed.landings,
    deploy: landed.deploy,
    graph,
    inbox,
    board,
    errors,
  };
}

// Several viewers at once share one gathering, at most one every two seconds.
let last = { at: 0, promise: null };
function state() {
  if (!last.promise || Date.now() - last.at > 2000) {
    last = { at: Date.now(), promise: gather() };
  }
  return last.promise;
}

// ---------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------

function send(response, status, type, body) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

export function startServer(port) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(path.join(HERE, 'index.html'), 'utf8');
        send(response, 200, 'text/html; charset=utf-8', html);
      } else if (url.pathname === '/api/state') {
        send(response, 200, 'application/json; charset=utf-8', JSON.stringify(await state()));
      } else {
        send(response, 404, 'text/plain; charset=utf-8', 'Олдсонгүй');
      }
    } catch (error) {
      console.error(`brain-monitor: ${error?.message ?? error}`);
      send(response, 500, 'text/plain; charset=utf-8', 'Алдаа гарлаа');
    }
  });
  server.on('error', (error) => {
    console.error(
      `brain-monitor: ${error.code === 'EADDRINUSE' ? `port ${port} is already in use` : error.message}`,
    );
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${port}`);
    console.log(`brain-monitor: ${['http://localhost:' + port, ...lan].join(', ')}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(Number.parseInt(process.env.BRAIN_MONITOR_PORT ?? '3310', 10));
}
