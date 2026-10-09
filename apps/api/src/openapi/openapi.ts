import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, getSchemaPath, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE } from '../common/errors/problem-details';
import { ProblemDetailsDto, ProblemFieldErrorDto } from '../common/errors/problem-details.dto';

/**
 * The published API contract (ADR-0004). The version is a constant so `pnpm gen:api` output is
 * deterministic; the running build is reported by /health instead.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Tugeel API')
    .setVersion('1.0.0')
    .addGlobalResponse({
      status: 'default',
      description: 'RFC 9457 problem details',
      content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } },
    })
    .build();
  return SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetailsDto, ProblemFieldErrorDto],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}
