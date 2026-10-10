import type { Permission } from '../auth';

/**
 * File kinds (ADR-0014, ADR-0029). Each module registers the kinds it attaches to its documents;
 * identity's `files` table only checks the `<module>.<kind>` format, so a new kind needs no change
 * to identity. Public kinds are served from a stable URL (later a CDN prefix), private kinds through
 * short-lived signed URLs.
 */
export interface FileKindDefinition {
  contentTypes: readonly string[];
  maxBytes: number;
  visibility: 'public' | 'private';
  /** Permission required to request an upload URL for this kind. */
  permission: Permission;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const FILE_KINDS = {
  'catalog.product_image': {
    contentTypes: IMAGE_TYPES,
    maxBytes: 5 * 1024 * 1024,
    visibility: 'public',
    permission: 'catalog.products.manage',
  },
  'catalog.product_thumb': {
    contentTypes: IMAGE_TYPES,
    maxBytes: 512 * 1024,
    visibility: 'public',
    permission: 'catalog.products.manage',
  },
} as const satisfies Record<string, FileKindDefinition>;

export type FileKind = keyof typeof FILE_KINDS;

export const FILE_KIND_PATTERN = /^[a-z]+\.[a-z_]+$/;

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === 'string' && Object.hasOwn(FILE_KINDS, value);
}

export function fileKind(kind: FileKind): FileKindDefinition {
  return FILE_KINDS[kind];
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** File-name extension for a content type the registry allows. */
export function extensionFor(contentType: string): string {
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new RangeError(`no extension for ${contentType}`);
  return extension;
}

/** Whether the first bytes of a file match its declared image type (JPEG, PNG, WebP). */
export function matchesMagicBytes(contentType: string, head: Uint8Array): boolean {
  const starts = (bytes: readonly number[], offset = 0) =>
    bytes.every((byte, index) => head[offset + index] === byte);
  switch (contentType) {
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff]);
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    default:
      return false;
  }
}
