import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { CHAT_BOT_BUTTONS, chatButtonOfText, chatLength } from '@tugeel/shared/chat';
import { chatAmount } from './services/chat-bot.service';
import { parseChatNotice } from './services/chat-notify';
import { CHAT_DEFAULT_TEXTS } from './services/chat-settings.service';

describe('chat rules (ADR-0224)', () => {
  const menu = CHAT_BOT_BUTTONS.map((id) => ({ id, label: mn.chat.bot.buttons[id] }));

  it('offers the owner’s five buttons, «Ажилтантай холбогдох» last', () => {
    expect(menu.map((button) => button.label)).toEqual([
      'Захиалгын төлөв',
      'Хүргэлтийн мэдээлэл',
      'Тооцооны үлдэгдэл',
      'Ажлын цаг, хаяг',
      'Ажилтантай холбогдох',
    ]);
  });

  it('takes a typed label for its button and nothing else', () => {
    expect(chatButtonOfText('  ТООЦООНЫ үлдэгдэл ', menu)).toBe('BALANCE');
    expect(chatButtonOfText('үлдэгдэл', menu)).toBeNull();
    expect(chatButtonOfText('', menu)).toBeNull();
  });

  it('counts characters, not UTF-16 units', () => {
    expect(chatLength('я😀')).toBe(2);
  });

  it('writes amounts without a float', () => {
    expect(chatAmount(new Decimal('12345678.5'))).toBe('12,345,678.50');
    expect(chatAmount(new Decimal('-2500.00'))).toBe('2,500');
    expect(chatAmount(new Decimal('0'))).toBe('0');
    expect(chatAmount(new Decimal('999'))).toBe('999');
  });

  it('reads a notice and refuses anything else', () => {
    expect(parseChatNotice('12:34:56')).toEqual({
      conversationId: 12,
      customerId: 34,
      messageId: 56,
    });
    expect(parseChatNotice('12:34:0')).toEqual({
      conversationId: 12,
      customerId: 34,
      messageId: null,
    });
    for (const bad of [undefined, '', '12:34', '0:1:2', '1:2:x', '1:2:3:4', '*']) {
      expect(parseChatNotice(bad)).toBeNull();
    }
  });

  it('ships default texts that promise nothing', () => {
    for (const text of Object.values(CHAT_DEFAULT_TEXTS)) {
      expect(text).not.toMatch(/[0-9]/);
    }
  });
});
