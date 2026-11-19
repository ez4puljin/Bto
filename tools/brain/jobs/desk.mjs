// The job desk's side in the APK scripts and the guard (ADR-0229, tools/brain/README.md «Jobs that
// run once»). On this PC an APK is built and published by `job.sh` (one build for every change that
// landed, in a clean copy of origin/main); `build-apk.mjs` and `publish-apk.mjs` refuse to run by
// hand in `~/bto-dev` or a task's copy, where they would carry other sessions' unfinished files.
// Pure where it can be: tests call `deskRefusal` and `runningJobs` with a scratch folder.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/** The desk's books: `$BTO_WORK/.brain/jobs` (the brain's books, tools/brain/lib.sh STATE). */
export function jobsDirOf(home, env = {}) {
  return join(env.BTO_WORK || join(home, 'bto-work'), '.brain', 'jobs');
}

/** A record of the books (`key=value` lines) as an object. */
export function parseRecord(text) {
  const record = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) record[line.slice(0, at)] = line.slice(at + 1);
  }
  return record;
}

/**
 * Is `pid` the desk's runner (`bash …/job.sh _run …`)? As job.sh's runner_alive: after a restart
 * the number may belong to another program, which must not count as a build.
 */
export function isRunner(pid, procDir = '/proc') {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code !== 'EPERM') return false;
  }
  if (!existsSync(procDir)) return true;
  try {
    return readFileSync(join(procDir, String(pid), 'cmdline'), 'utf8')
      .split('\0')
      .join(' ')
      .includes('job.sh _run');
  } catch {
    return false;
  }
}

/**
 * The desk's builds running now: `[{ kind, group, pid, commit }]`. A record whose process is gone
 * (the PC restarted) or is another program now is not running; `job.sh tick` deals with it.
 */
export function runningJobs(jobsDir, isAlive = isRunner) {
  if (!existsSync(jobsDir)) return [];
  const found = [];
  for (const kind of readdirSync(jobsDir)) {
    const file = join(jobsDir, kind, 'running');
    if (!existsSync(file)) continue;
    let record;
    try {
      record = parseRecord(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const pid = Number.parseInt(record.pid ?? '', 10);
    if (isAlive(pid))
      found.push({ kind, group: record.group ?? '', pid, commit: record.commit ?? '' });
  }
  return found;
}

/**
 * Why this APK script must not run here, or null.
 * @param {object} input
 * @param {'build'|'publish'} input.action
 * @param {string} input.kind     the desk's kind: `apk-staff` or `apk-customer`
 * @param {string} input.root     the workspace the script runs from
 * @param {string} input.home     the home folder
 * @param {Record<string, string|undefined>} input.env
 * @param {string[]} input.argv   the script's arguments (`--here` builds in place on purpose)
 * @param {Array<{group: string}>} input.running  the desk's running builds (runningJobs)
 */
export function deskRefusal({ action, kind, root, home, env, argv, running = [] }) {
  if (env.BTO_JOB_DESK === '1') return null;
  const work = env.BTO_WORK || `${home}/bto-work`;
  const shared = inside(root, `${home}/bto-dev`) || inside(root, work);
  if (!shared) return null;
  const desk = `bash ~/bto-dev/tools/brain/job.sh request ${kind}${action === 'publish' ? ' --publish' : ''}`;
  if (argv.includes('--here')) {
    if (action === 'build' && running.some((job) => job.group === 'android')) {
      return `The job desk is building an APK in ~/Android/m now; two builds there break each other. Wait for it (bash ~/bto-dev/tools/brain/job.sh status), or ask for yours: ${desk}`;
    }
    return null;
  }
  const what = action === 'build' ? 'An APK on this PC is built' : 'An APK on this PC is published';
  return `${what} by the job desk (ADR-0229), once for every change that has landed: ${desk}\n  (--here ${action === 'build' ? 'builds' : 'publishes'} from this checkout on purpose, outside the desk, e.g. for an emulator test.)`;
}
