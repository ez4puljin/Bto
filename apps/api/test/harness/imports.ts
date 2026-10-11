import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import type { ImportKind } from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { ImportPipelineService } from '../../src/modules/imports';
import { idempotency } from './catalog';
import { bearer } from './identity';

export interface ImportJobJson {
  id: number;
  kind: ImportKind;
  status: string;
  phase: string | null;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  warningRows: number;
  summary: {
    fileIssues?: { code: string; params?: Record<string, unknown> }[];
    actions?: Record<string, number>;
    errors?: Record<string, number>;
    warnings?: Record<string, number>;
    applied?: Record<string, number>;
    refreshed?: boolean;
    advisoryLocks?: number;
  } | null;
  lastError: { code: string; params?: Record<string, unknown> } | null;
  canRevert: boolean;
}

export interface ImportRowJson {
  rowNo: number;
  raw: Record<string, string | null>;
  errors: { column: string | null; code: string; params?: Record<string, unknown> }[];
  warnings: { column: string | null; code: string; params?: Record<string, unknown> }[];
  action: string | null;
  changed: string[];
}

/** An .xlsx sheet with the template labels of the keys used by the rows, then the rows. */
export async function sheetOf(
  kind: ImportKind,
  rows: readonly Record<string, unknown>[],
): Promise<Buffer> {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const labels = mn.imports.columns[kind] as Record<string, string>;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  sheet.addRow(keys.map((key) => labels[key] ?? key));
  for (const row of rows) sheet.addRow(keys.map((key) => row[key] ?? null));
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * HTTP helpers for imports as the admin behind `token`. The worker's steps run in-process through
 * ImportPipelineService, so tests do not wait for pg-boss.
 */
export function importsApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  const pipeline = app.get(ImportPipelineService);
  const get = async (id: number) =>
    (await http().get(`/api/v1/imports/${id}`).set(auth).expect(200)).body as ImportJobJson;

  return {
    http,
    get,
    async upload(bytes: Buffer): Promise<number> {
      const issued = (
        await http()
          .post('/api/v1/files/presign')
          .set(auth)
          .send({ kind: 'imports.source', contentType: XLSX_CONTENT_TYPE, sizeBytes: bytes.length })
          .expect(201)
      ).body as { fileId: number; uploadUrl: string };
      await http()
        .put(issued.uploadUrl)
        .set('Content-Type', XLSX_CONTENT_TYPE)
        .send(bytes)
        .expect(204);
      return issued.fileId;
    },
    /** Uploads a sheet, creates the job and runs the check; returns the checked job. */
    async check(
      kind: ImportKind,
      rows: readonly Record<string, unknown>[],
    ): Promise<ImportJobJson> {
      const fileId = await this.upload(await sheetOf(kind, rows));
      const created = (
        await http()
          .post('/api/v1/imports')
          .set(auth)
          .set(idempotency())
          .send({ kind, fileId, fileName: `${kind.toLowerCase()}.xlsx` })
          .expect(201)
      ).body as ImportJobJson;
      await pipeline.validate(created.id);
      return get(created.id);
    },
    async rows(
      id: number,
      filter: 'ERRORS' | 'WARNINGS' | 'ALL' = 'ALL',
    ): Promise<ImportRowJson[]> {
      const response = await http()
        .get(`/api/v1/imports/${id}/rows`)
        .query({ filter, limit: 200 })
        .set(auth)
        .expect(200);
      return (response.body as { data: ImportRowJson[] }).data;
    },
    /** Requests the commit and runs it. */
    async commit(id: number): Promise<ImportJobJson> {
      await http().post(`/api/v1/imports/${id}/commit`).set(auth).set(idempotency()).expect(200);
      await pipeline.commit(id);
      return get(id);
    },
    async revert(id: number): Promise<ImportJobJson> {
      await http().post(`/api/v1/imports/${id}/revert`).set(auth).set(idempotency()).expect(200);
      await pipeline.revert(id);
      return get(id);
    },
  };
}
