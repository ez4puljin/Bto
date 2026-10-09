// `pnpm ci:rehearse`: runs ci/compose.ci.yml (the CI "check" job on Linux) and always cleans up.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const compose = ['compose', '-f', join(import.meta.dirname, '..', 'ci', 'compose.ci.yml')];
const docker = (args) =>
  spawnSync('docker', [...compose, ...args], { stdio: 'inherit' }).status ?? 1;

docker(['down', '--remove-orphans']); // keeps the pnpm-store volume (cache); postgres runs on tmpfs
const status = docker(['run', '--rm', 'runner']);
docker(['down', '--remove-orphans']);
process.exit(status);
