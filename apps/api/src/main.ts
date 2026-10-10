import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/app-config';
import { configureHttpApp, HTTP_APP_OPTIONS } from './http-app';
import { buildOpenApiDocument } from './openapi/openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, HTTP_APP_OPTIONS);
  configureHttpApp(app);
  // useProcessExit lets pino flush its transports before the process ends.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  const config = app.get(AppConfig);
  if (config.get('NODE_ENV') !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }
  await app.listen(config.get('API_PORT'), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
