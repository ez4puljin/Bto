import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { AiController, AiReportsController } from './controllers/ai.controller';
import { AiExportService } from './services/ai-export.service';
import { AskFlowService } from './services/ask-flow.service';
import { ConversationsService } from './services/conversations.service';
import { ReportsService } from './services/reports.service';
import { AiReaderService } from './sql/ai-reader.service';

/**
 * The AI assistant (ADR-0045, docs/modules/ai.md): api only, imported by nobody. LLM_CLIENT comes
 * from the global LlmModule of the composition root; other modules' data only through the views
 * of schema ai, read by AiReaderService as role ai_reader.
 */
const SERVICES = [
  AiReaderService,
  AskFlowService,
  ConversationsService,
  ReportsService,
  AiExportService,
];

@Module({ imports: [IdentityModule], providers: SERVICES, exports: SERVICES })
export class AiModule {}

/** The HTTP side of the assistant. */
@Module({
  imports: [AiModule],
  controllers: [AiController, AiReportsController],
})
export class AiHttpModule {}
