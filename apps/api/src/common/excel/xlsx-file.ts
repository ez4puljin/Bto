import { StreamableFile } from '@nestjs/common';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';

/**
 * An Excel download: the ASCII name for old clients, the full (Mongolian) one in `filename*`
 * (RFC 6266). Both names come without the extension. Serves the ai, imports and export routes.
 */
export function xlsxFile(buffer: Buffer, asciiName: string, name = asciiName): StreamableFile {
  return new StreamableFile(buffer, {
    type: XLSX_CONTENT_TYPE,
    disposition: `attachment; filename="${asciiName}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
    length: buffer.length,
  });
}
