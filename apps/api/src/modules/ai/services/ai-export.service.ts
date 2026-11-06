import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { tableWorkbook } from '../../../common/excel/table-workbook';
import { AppError } from '../../../common/errors/app-error';
import type { AiAccess } from '../semantic/data-groups';
import { AiQueryError, AiReaderService, EXPORT_LIMITS } from '../sql/ai-reader.service';

/**
 * Excel downloads of a question's or a report's SQL (ADR-0045 #8, #11): the guard and the
 * read-only reader run again, rows stream into the workbook in batches, up to 20,000 rows.
 */
@Injectable()
export class AiExportService {
  constructor(private readonly reader: AiReaderService) {}

  async workbook(sql: string, sheetName: string, access: AiAccess): Promise<Buffer> {
    if (!this.reader.configured) throw new AppError('AI_NOT_CONFIGURED', 'no read-only database');
    try {
      return await tableWorkbook(
        sheetName,
        { yes: mn.common.yes, no: mn.common.no },
        async (sheet) => {
          await this.reader.stream(sql, access, EXPORT_LIMITS, (columns, rows) =>
            sheet.addRows(columns, rows),
          );
        },
      );
    } catch (error: unknown) {
      if (error instanceof AiQueryError) throw queryFailed(error);
      throw error;
    }
  }
}

/** A stored query that no longer runs (or times out): 422 with the code for the message. */
export function queryFailed(error: AiQueryError): AppError {
  if (error.code === 'DATA_ACCESS') {
    return new AppError('AI_DATA_FORBIDDEN', "the query reads data outside the person's groups");
  }
  return new AppError('AI_QUERY_FAILED', error.message, { code: error.code });
}
