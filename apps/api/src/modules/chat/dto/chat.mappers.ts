import type { ChatSettingsView } from '../services/chat-settings.service';
import type {
  ChatMessagePage,
  ChatMessageView,
  CustomerChat,
  CustomerChatState,
  StaffChat,
} from '../services/chat.service';
import type {
  ChatMessageDto,
  ChatMessagePageDto,
  ChatSettingsDto,
  CustomerChatConversationDto,
  CustomerChatDto,
  CustomerChatLiveEventDto,
  StaffChatConversationDto,
  StaffChatLiveEventDto,
} from './chat.dto';

// The chat's wire shapes from its views: the routes and the live hub send the same ones.

export function messageDto(message: ChatMessageView): ChatMessageDto {
  return { ...message, createdAt: message.createdAt.toISOString() };
}

export function messagePageDto(page: ChatMessagePage): ChatMessagePageDto {
  return { data: page.data.map(messageDto), nextCursor: page.nextCursor };
}

/** The store never reads the staff's counters. */
export function customerConversationDto(state: CustomerChatState): CustomerChatConversationDto {
  const { conversation } = state;
  return {
    id: conversation.id,
    mode: conversation.mode,
    awaitingStaff: conversation.awaitingStaff,
    unread: conversation.customerUnread,
    handedOffAt: conversation.handedOffAt?.toISOString() ?? null,
    buttons: state.buttons,
  };
}

export function customerChatDto(chat: CustomerChat): CustomerChatDto {
  return {
    conversation: customerConversationDto(chat),
    messages: chat.messages.map(messageDto),
    nextCursor: chat.nextCursor,
    rep: chat.rep ? { name: chat.rep.name, phone: chat.rep.phone } : null,
  };
}

export function customerLiveDto(
  state: CustomerChatState,
  message: ChatMessageView | null,
): CustomerChatLiveEventDto {
  return {
    conversation: customerConversationDto(state),
    message: message ? messageDto(message) : null,
  };
}

export function staffConversationDto(chat: StaffChat): StaffChatConversationDto {
  const { conversation } = chat;
  return {
    id: conversation.id,
    customerId: conversation.customerId,
    customerName: chat.customerName,
    customerCode: chat.customerCode,
    mode: conversation.mode,
    awaitingStaff: conversation.awaitingStaff,
    unread: conversation.staffUnread,
    handedOffAt: conversation.handedOffAt?.toISOString() ?? null,
    closedAt: conversation.closedAt?.toISOString() ?? null,
    lastMessage: chat.lastMessage ? messageDto(chat.lastMessage) : null,
    reps: chat.reps,
  };
}

export function staffLiveDto(
  chat: StaffChat,
  message: ChatMessageView | null,
): StaffChatLiveEventDto {
  return {
    conversation: staffConversationDto(chat),
    message: message ? messageDto(message) : null,
  };
}

export function settingsDto(view: ChatSettingsView): ChatSettingsDto {
  return {
    ...view.texts,
    defaults: view.defaults,
    updatedAt: view.updatedAt?.toISOString() ?? null,
  };
}
