import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildOpenApiDocument } from '../../src/openapi/openapi';
import { createHttpApp } from '../harness/apps';

describe('OpenAPI document (ADR-0004)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createHttpApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('publishes /health outside /api/v1 and the problem details schema', () => {
    const document = buildOpenApiDocument(app);
    expect(document.paths['/health']?.get).toBeDefined();
    expect(document.paths['/api/v1/health']).toBeUndefined();
    expect(document.components?.schemas?.ProblemDetails).toBeDefined();
    expect(document.components?.schemas?.HealthResponse).toBeDefined();
    expect(document.info.version).toBe('1.0.0');
  });
});
