import './openapi-env';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { configureHttpApp, HTTP_APP_OPTIONS } from '../http-app';
import { buildOpenApiDocument } from './openapi';

/** `node dist/openapi/export-openapi.js <out.json>`; runs on `nest build` output (swagger plugin metadata). */
async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? 'openapi.json');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...HTTP_APP_OPTIONS,
    logger: false,
    abortOnError: false,
  });
  configureHttpApp(app);
  const document = buildOpenApiDocument(app);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
