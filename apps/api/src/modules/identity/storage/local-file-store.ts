import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

export type Visibility = 'public' | 'private';

/** Server-generated object names: `<uuid>.<ext>`. Nothing else ever reaches the file system. */
const OBJECT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{3,4}$/;

export function isObjectName(name: string): boolean {
  return OBJECT_NAME.test(name);
}

export class ObjectTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`object larger than ${maxBytes} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

export interface WrittenObject {
  /** Temporary path; `commit` moves it to its final place, `discard` deletes it. */
  tempPath: string;
  size: number;
  sha256: string;
  /** The first bytes, for a signature check. */
  head: Buffer;
}

/**
 * The local storage driver (ADR-0030): `<root>/public` and `<root>/private` hold the objects,
 * `<root>/.tmp` receives uploads on the same volume so the final move is a rename. Directories are
 * created on first write, never at start-up.
 */
export class LocalFileStore {
  constructor(private readonly root: string) {}

  path(visibility: Visibility, name: string): string {
    if (!isObjectName(name)) throw new RangeError(`not an object name: ${name}`);
    return join(this.root, visibility, name);
  }

  /** Streams a body into a temporary file, refusing more than `maxBytes`; never leaves a partial file. */
  async receive(name: string, body: Readable, maxBytes: number): Promise<WrittenObject> {
    if (!isObjectName(name)) throw new RangeError(`not an object name: ${name}`);
    const tempDir = join(this.root, '.tmp');
    await mkdir(tempDir, { recursive: true });
    const tempPath = join(tempDir, `${name}.${randomBytes(6).toString('hex')}`);
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > maxBytes) {
          done(new ObjectTooLargeError(maxBytes));
          return;
        }
        hash.update(chunk);
        if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        done(null, chunk);
      },
    });
    try {
      await pipeline(body, meter, createWriteStream(tempPath, { flags: 'wx' }));
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return { tempPath, size, sha256: hash.digest('hex'), head };
  }

  /** Moves a received object into place (retrying briefly: antivirus scanners lock new files on Windows). */
  async commit(written: WrittenObject, visibility: Visibility, name: string): Promise<void> {
    const target = this.path(visibility, name);
    await mkdir(join(this.root, visibility), { recursive: true });
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(written.tempPath, target);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES'))
          throw error;
        await delay(50 * attempt);
      }
    }
  }

  async discard(written: WrittenObject): Promise<void> {
    await rm(written.tempPath, { force: true });
  }

  /** Size of a stored object, or null when it does not exist. */
  async size(visibility: Visibility, name: string): Promise<number | null> {
    try {
      return (await stat(this.path(visibility, name))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  read(visibility: Visibility, name: string): Readable {
    return createReadStream(this.path(visibility, name));
  }

  async remove(visibility: Visibility, name: string): Promise<void> {
    await rm(this.path(visibility, name), { force: true });
  }
}
