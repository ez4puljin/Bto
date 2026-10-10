import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import {
  extensionFor,
  type FileKind,
  fileKind,
  isFileKind,
  matchesMagicBytes,
} from '@tugeel/shared/files';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../auth-context';
import { files } from '../schema';
import {
  isObjectName,
  LocalFileStore,
  ObjectTooLargeError,
  type WrittenObject,
} from '../storage/local-file-store';

export type StoredFile = typeof files.$inferSelect;

/** Path of public objects under the API prefix; the go-live Spaces driver swaps in the CDN prefix. */
export const PUBLIC_FILES_PATH = '/api/v1/files/public';

/**
 * Files of every module (ADR-0014, ADR-0030). Identity owns the `files` table: other modules attach a
 * file to their document by calling `verifyUploaded` before their transaction and `confirm` inside
 * it, and never touch the table themselves.
 */
@Injectable()
export class StorageService {
  private readonly store: LocalFileStore;

  constructor(
    @Inject(DB) private readonly db: Db,
    config: AppConfig,
  ) {
    this.store = new LocalFileStore(config.get('STORAGE_LOCAL_DIR'));
  }

  /** A PENDING row for an upload the caller may make; the HTTP layer adds the signed URL. */
  async createPending(
    ctx: AuthContext,
    input: { kind: FileKind; contentType: string; sizeBytes: number },
  ): Promise<StoredFile> {
    const definition = fileKind(input.kind);
    if (!ctx.permissions.has(definition.permission)) {
      throw new AppError('FORBIDDEN', `upload of ${input.kind} not permitted`, {
        reason: 'PERMISSION',
      });
    }
    if (!definition.contentTypes.includes(input.contentType)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `${input.contentType} not allowed`, {
        allowed: definition.contentTypes.join(', '),
      });
    }
    if (input.sizeBytes > definition.maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', `file over ${definition.maxBytes} bytes`, {
        maxBytes: definition.maxBytes,
      });
    }
    const [row] = await this.db
      .insert(files)
      .values({
        key: `${randomUUID()}.${extensionFor(input.contentType)}`,
        kind: input.kind,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ownerId: ctx.userId,
      })
      .returning();
    if (!row) throw new Error('file insert returned no row');
    return row;
  }

  async findByKey(key: string): Promise<StoredFile | null> {
    if (!isObjectName(key)) return null;
    const [row] = await this.db.select().from(files).where(eq(files.key, key));
    return row ?? null;
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<StoredFile | null> {
    const [row] = await executor.select().from(files).where(eq(files.id, id));
    return row ?? null;
  }

  /**
   * Stores the body of a signed local upload: exactly the declared size, a matching image signature,
   * once. Throws PAYLOAD_TOO_LARGE, BAD_REQUEST, UNSUPPORTED_MEDIA_TYPE or CONFLICT; leaves no file
   * behind on failure.
   */
  async receiveUpload(file: StoredFile, body: Readable): Promise<void> {
    const kind = this.kindOf(file);
    let written: WrittenObject;
    try {
      written = await this.store.receive(file.key, body, file.sizeBytes);
    } catch (error) {
      if (error instanceof ObjectTooLargeError) {
        throw new AppError('PAYLOAD_TOO_LARGE', 'upload larger than declared', {
          maxBytes: file.sizeBytes,
        });
      }
      throw error;
    }
    try {
      if (written.size !== file.sizeBytes) {
        throw new AppError('BAD_REQUEST', `upload has ${written.size} of ${file.sizeBytes} bytes`);
      }
      if (!matchesMagicBytes(file.contentType, written.head)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'content does not match its type');
      }
      const [claimed] = await this.db
        .update(files)
        .set({ uploadedAt: sql`now()`, sha256: written.sha256, updatedAt: sql`now()` })
        .where(and(eq(files.id, file.id), eq(files.status, 'PENDING'), isNull(files.uploadedAt)))
        .returning({ id: files.id });
      if (!claimed) throw new AppError('CONFLICT', `file ${file.id} was already uploaded`);
      try {
        await this.store.commit(written, fileKind(kind).visibility, file.key);
      } catch (error) {
        await this.db
          .update(files)
          .set({ uploadedAt: null, sha256: null, updatedAt: sql`now()` })
          .where(eq(files.id, file.id));
        throw error;
      }
    } finally {
      await this.store.discard(written);
    }
  }

  /**
   * Checks, before the attaching transaction, that a file of this kind was uploaded completely
   * (the Spaces driver will make an HTTP HEAD call here, so never call it inside a transaction).
   */
  async verifyUploaded(fileId: number, kind: FileKind): Promise<StoredFile> {
    const file = await this.get(fileId);
    if (!file || file.status === 'DELETED') {
      throw new AppError('NOT_FOUND', `file ${fileId} not found`, { id: fileId });
    }
    if (file.kind !== kind) {
      throw new AppError('FILE_KIND_MISMATCH', `file ${fileId} is ${file.kind}, not ${kind}`);
    }
    const size = file.uploadedAt
      ? await this.store.size(fileKind(kind).visibility, file.key)
      : null;
    if (size !== file.sizeBytes) {
      throw new AppError('FILE_NOT_UPLOADED', `file ${fileId} has not arrived`, { id: fileId });
    }
    return file;
  }

  /** Marks a verified upload READY inside the transaction that attaches it to a document. */
  async confirm(tx: Tx, fileId: number, kind: FileKind): Promise<StoredFile> {
    const [row] = await tx
      .update(files)
      .set({ status: 'READY', updatedAt: sql`now()` })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.kind, kind),
          eq(files.status, 'PENDING'),
          sql`${files.uploadedAt} IS NOT NULL`,
        ),
      )
      .returning();
    if (!row) {
      throw new AppError('FILE_NOT_UPLOADED', `file ${fileId} cannot be attached`, { id: fileId });
    }
    return row;
  }

  /** Detaches a file inside the owning document's transaction; the bytes go with the cleanup job. */
  async markDeleted(tx: Tx, fileId: number): Promise<void> {
    await tx
      .update(files)
      .set({ status: 'DELETED', updatedAt: sql`now()` })
      .where(eq(files.id, fileId));
  }

  /** The stable URL of a public file (READY files only are served). */
  publicUrl(file: Pick<StoredFile, 'key'>): string {
    return `${PUBLIC_FILES_PATH}/${file.key}`;
  }

  /** Public URLs of READY files by id, for lists that show images (missing ids are left out). */
  async publicUrls(
    fileIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, string>> {
    if (fileIds.length === 0) return new Map();
    const rows = await executor
      .select({ id: files.id, key: files.key })
      .from(files)
      .where(and(inArray(files.id, [...fileIds]), eq(files.status, 'READY')));
    return new Map(rows.map((row) => [row.id, this.publicUrl(row)]));
  }

  /** The bytes of a READY file of a public kind, or null; used by the public route. */
  async openPublic(key: string): Promise<{ file: StoredFile; body: Readable } | null> {
    const file = await this.findByKey(key);
    if (!file || file.status !== 'READY' || !isFileKind(file.kind)) return null;
    if (fileKind(file.kind).visibility !== 'public') return null;
    if ((await this.store.size('public', file.key)) === null) return null;
    return { file, body: this.store.read('public', file.key) };
  }

  private kindOf(file: StoredFile): FileKind {
    if (!isFileKind(file.kind)) throw new Error(`file ${file.id} has an unknown kind ${file.kind}`);
    return file.kind;
  }
}
