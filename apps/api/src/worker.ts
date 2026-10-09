import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // createApplicationContext() runs init(): onModuleInit starts pg-boss, onApplicationBootstrap
  // registers the job handlers and the loopback health endpoint.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // pg-boss stops gracefully (beforeApplicationShutdown) before the database pool closes.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  app.get(Logger).log('worker started');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
