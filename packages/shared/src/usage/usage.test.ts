import { describe, expect, it } from 'vitest';
import {
  isUsageApp,
  screenKeyFromPath,
  screenKeyFromSegments,
  USAGE,
  usageEventsToSend,
  UsageMeter,
  usageScreenOk,
} from './index';

describe('screen names', () => {
  it('puts the web address back together with its parameter names', () => {
    expect(screenKeyFromPath('/catalog/products/4182', { id: '4182' })).toBe(
      '/catalog/products/:id',
    );
    expect(screenKeyFromPath('/sales/orders/9/print/invoice', { id: '9', kind: 'invoice' })).toBe(
      '/sales/orders/:id/print/:kind',
    );
    expect(screenKeyFromPath('/reports/aging')).toBe('/reports/aging');
    expect(screenKeyFromPath('/')).toBe('/');
    expect(screenKeyFromPath('/reports/aging/')).toBe('/reports/aging');
  });

  it('never lets an id make a screen of its own, named or not', () => {
    expect(screenKeyFromPath('/catalog/products/4182')).toBe('/catalog/products/:id');
    expect(screenKeyFromPath('/notice/7f3b1c2d-aa10-4f3e-9f0a-2b7c8d9e0f11')).toBe('/notice/:x');
  });

  it('reads the apps route segments as they were written', () => {
    expect(screenKeyFromSegments(['(staff)', 'order', '[id]'])).toBe('/order/:id');
    expect(screenKeyFromSegments(['(customer)', '(tabs)', 'cart'])).toBe('/cart');
    expect(screenKeyFromSegments(['(staff)', 'community', 'poll', '[id]'])).toBe(
      '/community/poll/:id',
    );
    expect(screenKeyFromSegments([])).toBe('/');
    expect(screenKeyFromSegments(['shop', '[...rest]'])).toBe('/shop/:rest');
  });

  it('accepts the names it makes and refuses anything else', () => {
    expect(usageScreenOk('/catalog/products/:id')).toBe(true);
    expect(usageScreenOk('/')).toBe(true);
    expect(usageScreenOk('catalog')).toBe(false);
    expect(usageScreenOk('/catalog/products?q=1')).toBe(false);
    expect(usageScreenOk('/caталог')).toBe(false);
    expect(usageScreenOk(`/${'a'.repeat(USAGE.screenMax)}`)).toBe(false);
  });

  it('knows the three clients', () => {
    expect(isUsageApp('customer')).toBe(true);
    expect(isUsageApp('pos')).toBe(false);
  });
});

describe('what a client sends', () => {
  it('cuts a tab left open back to the time a screen can be used', () => {
    const [event] = usageEventsToSend([{ screen: '/home', opens: 1, seconds: 40_000 }]);
    expect(event?.seconds).toBe(USAGE.maxSecondsPerOpen);
  });

  it('drops a name it would not accept back and keeps the busiest screens', () => {
    const many = Array.from({ length: USAGE.maxEvents + 10 }, (_, i) => ({
      screen: `/screen-${i}`,
      opens: i + 1,
      seconds: i,
    }));
    const sent = usageEventsToSend([
      ...many,
      { screen: '/bad screen', opens: 99, seconds: 1 },
      { screen: '/nothing', opens: 0, seconds: 0 },
    ]);
    expect(sent).toHaveLength(USAGE.maxEvents);
    expect(sent.map((event) => event.screen)).not.toContain('/bad screen');
    expect(sent.map((event) => event.screen)).not.toContain('/nothing');
    expect(sent[0]?.opens).toBe(USAGE.maxEvents + 10);
  });

  it('rounds what a clock hands it and never sends a negative', () => {
    expect(usageEventsToSend([{ screen: '/home', opens: 1.4, seconds: -3 }])).toEqual([
      { screen: '/home', opens: 1, seconds: 0 },
    ]);
  });

  it('keeps the seconds of a screen that only stayed open', () => {
    expect(usageEventsToSend([{ screen: '/sales/work', opens: 0, seconds: 59.6 }])).toEqual([
      { screen: '/sales/work', opens: 0, seconds: 60 },
    ]);
  });
});

describe('the counter', () => {
  const S = 1000;

  it('counts an open per screen that comes in front, and the time it stood there', () => {
    const meter = new UsageMeter();
    meter.show('/home', 0);
    meter.show('/sales/work', 10 * S);
    meter.show('/home', 40 * S);
    expect(meter.take(45 * S)).toEqual([
      { screen: '/home', opens: 2, seconds: 15 },
      { screen: '/sales/work', opens: 1, seconds: 30 },
    ]);
    // Taken once: nothing is sent twice.
    expect(meter.take(45 * S)).toEqual([]);
  });

  it('does not count the same screen again when only its address changed', () => {
    const meter = new UsageMeter();
    meter.show('/reports/aging', 0);
    meter.show('/reports/aging', 5 * S);
    expect(meter.take(20 * S)).toEqual([{ screen: '/reports/aging', opens: 1, seconds: 20 }]);
  });

  it('goes on counting a screen that stays open through the next minute, without a new open', () => {
    const meter = new UsageMeter();
    meter.show('/sales/work', 0);
    expect(meter.take(60 * S)).toEqual([{ screen: '/sales/work', opens: 1, seconds: 60 }]);
    expect(meter.take(120 * S)).toEqual([{ screen: '/sales/work', opens: 0, seconds: 60 }]);
  });

  it('stops the time while the window is out of sight', () => {
    const meter = new UsageMeter();
    meter.show('/home', 0);
    meter.hide(10 * S);
    meter.back(3_600 * S);
    expect(meter.take(3_605 * S)).toEqual([{ screen: '/home', opens: 1, seconds: 15 }]);
  });

  it('stops counting a screen nobody left, at the time a screen can be used', () => {
    const meter = new UsageMeter();
    meter.show('/home', 0);
    expect(meter.take(60 * S)[0]?.seconds).toBe(60);
    // Nine more minutes fill the ten; after that the forgotten tab adds nothing.
    expect(meter.take(USAGE.maxSecondsPerOpen * S)[0]?.seconds).toBe(USAGE.maxSecondsPerOpen - 60);
    expect(meter.take(8 * 3_600 * S)).toEqual([]);
    // Opening another screen and coming back is a new open, counted afresh.
    meter.show('/other', 8 * 3_600 * S);
    meter.show('/home', 8 * 3_600 * S + 5 * S);
    expect(meter.take(8 * 3_600 * S + 15 * S)).toEqual([
      { screen: '/home', opens: 1, seconds: 10 },
      { screen: '/other', opens: 1, seconds: 5 },
    ]);
  });

  it('is not put out by a clock that steps back', () => {
    const meter = new UsageMeter();
    meter.show('/home', 100 * S);
    expect(meter.take(50 * S)).toEqual([{ screen: '/home', opens: 1, seconds: 0 }]);
  });
});
