import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EdgeConfig } from './edge/config/edge-env';
import { EdgeModule } from './edge/edge.module';
import { configureEdgeHttpApp, EDGE_APP_OPTIONS } from './edge/edge-http';

/** The store edge (ADR-0067): `ROLE=edge` in the api image, `pnpm dev:edge` locally. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    EdgeModule.forRoot(),
    EDGE_APP_OPTIONS,
  );
  configureEdgeHttpApp(app);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  await app.listen(app.get(EdgeConfig).get('EDGE_PORT'), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
