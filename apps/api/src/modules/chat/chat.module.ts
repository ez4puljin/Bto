import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { SalesModule } from '../sales';
import { CustomerChatController } from './controllers/customer-chat.controller';
import { ChatSettingsController, StaffChatController } from './controllers/staff-chat.controller';
import { ChatBotService } from './services/chat-bot.service';
import { ChatRepsService } from './services/chat-reps.service';
import { ChatSettingsService } from './services/chat-settings.service';
import { ChatHub } from './services/chat.hub';
import { ChatService } from './services/chat.service';

/**
 * The customer chat of «Bto300» (docs/modules/chat.md, ADR-0224): a store's one conversation, the
 * scripted bot, the hand-off to staff. It reads the store's orders and rounds through sales, its
 * balance through finance and its credit terms through partners; nobody imports it.
 */
@Module({
  imports: [IdentityModule, PartnersModule, SalesModule, FinanceModule],
  providers: [ChatSettingsService, ChatRepsService, ChatBotService, ChatService],
  exports: [ChatSettingsService, ChatRepsService, ChatBotService, ChatService],
})
export class ChatModule {}

/**
 * The HTTP side of the chat (api only), with the live hub: one LISTEN connection per api process
 * that has a chat stream open (ADR-0224 #7); the worker, the edge and the CLIs never hold it.
 */
@Module({
  imports: [ChatModule],
  controllers: [CustomerChatController, StaffChatController, ChatSettingsController],
  providers: [ChatHub],
})
export class ChatHttpModule {}
