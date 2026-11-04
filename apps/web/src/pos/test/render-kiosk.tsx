import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { KioskApp } from '../app';
import {
  CASHIER_STORAGE_KEY,
  DEVICE_STORAGE_KEY,
  EdgeClient,
  KioskCredentials,
  SESSION_STORAGE_KEY,
} from '../edge-client';
import { type FakeEdge, TILL } from './fake-edge';

/**
 * The kiosk against a fake edge (`print` counts the receipts sent to the printer). `device` stores a paired browser's token, `session` a signed-in
 * cashier's (with `cashierId`), as a reload of the page would find them.
 */
export function renderKiosk(
  edge: FakeEdge,
  options: {
    device?: string;
    session?: string;
    cashierId?: number;
    /** The POS page (`…/K1`); null: the start page. A bound device defaults to К1's page. */
    addressTill?: string | null;
  } = {},
) {
  // A bound device sells on its POS's page (ADR-0138): the start page never does.
  const addressTill =
    options.addressTill !== undefined ? options.addressTill : options.device ? TILL.code : null;
  const key = (name: string) => (addressTill ? `${name}@${addressTill}` : name);
  if (options.device) localStorage.setItem(key(DEVICE_STORAGE_KEY), options.device);
  if (options.session) sessionStorage.setItem(key(SESSION_STORAGE_KEY), options.session);
  if (options.cashierId) {
    sessionStorage.setItem(key(CASHIER_STORAGE_KEY), String(options.cashierId));
  }
  const credentials = new KioskCredentials(undefined, addressTill);
  const navigate = vi.fn<(url: string) => void>();
  const client = new EdgeClient(credentials, { baseUrl: 'http://edge.test', fetch: edge.fetch });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The receipt prints with the browser's own printing (ADR-0065); jsdom has no printer.
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  render(
    <KioskApp
      services={{ client, credentials, addressTill, navigate }}
      queryClient={queryClient}
    />,
  );
  return { credentials, client, queryClient, print, navigate };
}
