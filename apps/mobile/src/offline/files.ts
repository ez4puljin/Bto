import { Directory, File, Paths } from 'expo-file-system';
import { readJson, userKey, writeJson } from '../device/storage';
import { isPointer, type KeptDisk } from './walk';

/**
 * The kept copy on the phone's disk: `<documents>/bto-offline/<server>-<userId>/<gen>/` with one
 * file per downloaded page (`p-N.json` the products, `c-N.json` the customers) and
 * `context.json`, `categories.json`, `suppliers.json`; the copy in use is named by the pointer in
 * app storage (`bto.offline.v1:<server>:<userId>`). Files, not AsyncStorage values: Android's
 * storage rows are too small for 8 MiB.
 */
const slugOf = (server: string, userId: number) =>
  `${server.replace(/[^a-z0-9]+/gi, '_')}-${userId}`;

export function keptDisk(server: string, userId: number): KeptDisk {
  const slug = slugOf(server, userId);
  const root = () => new Directory(Paths.document, 'bto-offline', slug);
  const pointerKey = userKey('offline', server, userId);
  return {
    id: pointerKey,
    async loadPointer() {
      const value = await readJson(pointerKey);
      return isPointer(value) ? value : null;
    },
    async savePointer(pointer) {
      await writeJson(pointerKey, pointer);
      // writeJson never rejects: read it back so a failed swap is a failed walk.
      const back = await readJson(pointerKey);
      if (!isPointer(back) || back.gen !== pointer.gen) throw new Error('pointer not stored');
    },
    write(gen, name, text) {
      const folder = new Directory(root(), gen);
      folder.create({ intermediates: true, idempotent: true });
      const file = new File(folder, name);
      file.create({ overwrite: true });
      file.write(text);
      return Promise.resolve();
    },
    read(gen, name) {
      return new File(root(), gen, name).text();
    },
    gens() {
      const folder = root();
      if (!folder.exists) return Promise.resolve([]);
      return Promise.resolve(
        folder
          .list()
          .filter((entry): entry is Directory => entry instanceof Directory)
          .map((entry) => entry.name),
      );
    },
    removeGen(gen) {
      const folder = new Directory(root(), gen);
      if (folder.exists) folder.delete();
      return Promise.resolve();
    },
  };
}

/**
 * Removes a user's kept copy and its pointer (ADR-0225 #2, review 2026-11-20): the store list and
 * the prices do not stay on a phone nobody is signed in on. At «Гарах» and when the server ends
 * the session. The outbox is not touched: it survives a sign-out and goes after the next sign-in.
 */
export async function forgetKept(server: string, userId: number): Promise<void> {
  await writeJson(userKey('offline', server, userId), null);
  try {
    const folder = new Directory(Paths.document, 'bto-offline', slugOf(server, userId));
    if (folder.exists) folder.delete();
  } catch {
    // A folder that cannot be removed now is removed by the next walk's clean-up.
  }
}
