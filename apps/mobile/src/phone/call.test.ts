import { describe, expect, it, vi } from 'vitest';
import { CALL_COOLDOWN_MS, type CallDevice, callerOf, telUriOf } from './dial';

const URI = 'tel:+97699112233';

/** A phone whose CALL_PHONE is `granted` and whose prompt answers `answer`. */
const device = (over: Partial<CallDevice> & { granted?: boolean; answer?: string } = {}) => {
  const { granted = false, answer = 'granted', ...rest } = over;
  return {
    direct: true,
    hasPermission: vi.fn(() => Promise.resolve(granted)),
    askPermission: vi.fn(() => Promise.resolve(answer)),
    startCall: vi.fn(() => new Promise<unknown>(() => undefined)),
    openDialer: vi.fn(() => Promise.resolve(true)),
    ...rest,
  };
};

/** Lets the rejections and their fallbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a number as a tel: URI', () => {
  it('keeps the digits and one leading plus', () => {
    expect(telUriOf('+97699112233')).toBe(URI);
    expect(telUriOf(' +976 9911-2233 ')).toBe(URI);
    expect(telUriOf('(+976) 99 11 22 33')).toBe(URI);
    expect(telUriOf('++976 99112233')).toBe(URI);
    expect(telUriOf('9911 2233')).toBe('tel:99112233');
    expect(telUriOf('976+99112233')).toBe('tel:97699112233');
  });

  it('is null without a digit', () => {
    expect(telUriOf('')).toBeNull();
    expect(telUriOf(' + - ')).toBeNull();
  });
});

describe('a tap on a number', () => {
  it('calls at once when the permission is granted, without awaiting the call', async () => {
    const phone = device({ granted: true });
    await expect(callerOf(phone)('+976 9911 2233')).resolves.toBe('called');
    expect(phone.startCall).toHaveBeenCalledWith(URI);
    expect(phone.askPermission).not.toHaveBeenCalled();
    expect(phone.openDialer).not.toHaveBeenCalled();
  });

  it('asks on the first tap and calls when the rep allows it', async () => {
    const phone = device();
    const call = callerOf(phone);
    await expect(call(URI)).resolves.toBe('called');
    expect(phone.askPermission).toHaveBeenCalledOnce();
    expect(phone.startCall).toHaveBeenCalledWith(URI);
  });

  it('opens the dialer after a «no» and does not ask again', async () => {
    const phone = device({ answer: 'denied' });
    const call = callerOf(phone);
    await expect(call(URI)).resolves.toBe('dialer');
    await expect(call(URI)).resolves.toBe('dialer');
    expect(phone.askPermission).toHaveBeenCalledOnce();
    expect(phone.openDialer).toHaveBeenCalledTimes(2);
    expect(phone.startCall).not.toHaveBeenCalled();
  });

  it('opens the dialer after «never ask again»', async () => {
    const phone = device({ answer: 'never_ask_again' });
    await expect(callerOf(phone)(URI)).resolves.toBe('dialer');
    expect(phone.openDialer).toHaveBeenCalledWith(URI);
  });

  it('only opens the dialer off Android', async () => {
    const phone = device({ direct: false, granted: true });
    await expect(callerOf(phone)(URI)).resolves.toBe('dialer');
    expect(phone.hasPermission).not.toHaveBeenCalled();
    expect(phone.startCall).not.toHaveBeenCalled();
    expect(phone.openDialer).toHaveBeenCalledWith(URI);
  });

  it('falls back to the dialer when Android refuses the call', async () => {
    const phone = device({
      granted: true,
      startCall: vi.fn(() => Promise.reject(new Error('SecurityException'))),
    });
    await expect(callerOf(phone)(URI)).resolves.toBe('called');
    await settle();
    expect(phone.openDialer).toHaveBeenCalledWith(URI);
  });

  it('opens the dialer when the permission check fails', async () => {
    const phone = device({ hasPermission: vi.fn(() => Promise.reject(new Error('no activity'))) });
    await expect(callerOf(phone)(URI)).resolves.toBe('dialer');
    expect(phone.openDialer).toHaveBeenCalledWith(URI);
  });

  it('never throws, even without a dialer', async () => {
    const phone = device({
      answer: 'denied',
      openDialer: vi.fn(() => Promise.reject(new Error('no handler'))),
    });
    await expect(callerOf(phone)(URI)).resolves.toBe('dialer');
  });

  it('does nothing without a number', async () => {
    const phone = device({ granted: true });
    await expect(callerOf(phone)(' - ')).resolves.toBe('none');
    expect(phone.hasPermission).not.toHaveBeenCalled();
    expect(phone.openDialer).not.toHaveBeenCalled();
  });

  it('places one call for a double tap', async () => {
    const phone = device({ granted: true });
    const call = callerOf(phone);
    const [first, second] = await Promise.all([call(URI), call(URI)]);
    expect([first, second]).toEqual(['called', 'called']);
    expect(phone.startCall).toHaveBeenCalledOnce();
  });

  it('places one call for a second tap after the first resolved, within the cooldown', async () => {
    let clock = 1_000;
    const phone = device({ granted: true, now: () => clock });
    const call = callerOf(phone);
    await expect(call(URI)).resolves.toBe('called');
    await settle();
    clock += 300;
    await expect(call(URI)).resolves.toBe('called');
    await settle();
    expect(phone.startCall).toHaveBeenCalledOnce();
    expect(phone.openDialer).not.toHaveBeenCalled();

    // A call Android settles at once (before the in-call screen) does not end the cooldown.
    const quick = device({
      granted: true,
      now: () => clock,
      startCall: vi.fn(() => Promise.resolve(0)),
    });
    const quickCall = callerOf(quick);
    await quickCall(URI);
    await settle();
    clock += 300;
    await quickCall(URI);
    expect(quick.startCall).toHaveBeenCalledOnce();
  });

  it('calls again after the cooldown', async () => {
    let clock = 1_000;
    const phone = device({ granted: true, now: () => clock });
    const call = callerOf(phone);
    await call(URI);
    clock += CALL_COOLDOWN_MS;
    await expect(call(URI)).resolves.toBe('called');
    expect(phone.startCall).toHaveBeenCalledTimes(2);
  });

  it('opens the dialer past the cooldown when an earlier call never came back', async () => {
    let clock = 1_000;
    const already = Object.assign(new Error('already started'), {
      code: 'E_ACTIVITY_ALREADY_STARTED',
    });
    const startCall = vi
      .fn<(uri: string) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise<unknown>(() => undefined))
      .mockImplementationOnce(() => Promise.reject(already));
    const phone = device({ granted: true, now: () => clock, startCall });
    const call = callerOf(phone);
    await call(URI);
    clock += CALL_COOLDOWN_MS + 1;
    await expect(call(URI)).resolves.toBe('called');
    await settle();
    expect(startCall).toHaveBeenCalledTimes(2);
    expect(phone.openDialer).toHaveBeenCalledOnce();
    expect(phone.openDialer).toHaveBeenCalledWith(URI);
  });
});
