import { afterEach, describe, expect, it } from 'vitest';
import { scanBlocked } from './use-wedge-scanner';

const element = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scanBlocked (ADR-0047 #4)', () => {
  it('lets a scan reach the page while no dialog is open', () => {
    element('<div id="box"></div><div role="dialog" data-state="closed"></div>');
    expect(scanBlocked(document.getElementById('box'))).toBe(false);
  });

  it('holds scans back from the page while a dialog is open over it', () => {
    element('<div id="box"></div><div role="dialog" data-state="open"></div>');
    expect(scanBlocked(document.getElementById('box'))).toBe(true);
    expect(scanBlocked(null)).toBe(true);
  });

  it('lets a scan box inside the open dialog read', () => {
    element('<div role="dialog" data-state="open"><div id="box"></div></div>');
    expect(scanBlocked(document.getElementById('box'))).toBe(false);
  });

  it('holds scans back from a page made inert behind the phone menu', () => {
    element('<main inert><div id="box"></div></main>');
    expect(scanBlocked(document.getElementById('box'))).toBe(true);
  });
});
