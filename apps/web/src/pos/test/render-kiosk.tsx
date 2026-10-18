import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { KioskApp } from '../app';
import {
  CASHIER_STORAGE_KEY,
  DEVICE_STORAGE_KEY,
  EdgeClient,
  KioskCredentials,
  SESSION_STORAGE_KEY,
} from '../edge-client';
import type { FakeEdge } from './fake-edge';

/**
 * The kiosk against a fake edge. `device` stores a paired browser's token, `session` a signed-in
 * cashier's (with `cashierId`), as a reload of the page would find them.
 */
export function renderKiosk(
  edge: FakeEdge,
  options: { device?: string; session?: string; cashierId?: number } = {},
) {
  if (options.device) localStorage.setItem(DEVICE_STORAGE_KEY, options.device);
  if (options.session) sessionStorage.setItem(SESSION_STORAGE_KEY, options.session);
  if (options.cashierId) sessionStorage.setItem(CASHIER_STORAGE_KEY, String(options.cashierId));
  const credentials = new KioskCredentials();
  const client = new EdgeClient(credentials, { baseUrl: 'http://edge.test', fetch: edge.fetch });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<KioskApp services={{ client, credentials }} queryClient={queryClient} />);
  return { credentials, client, queryClient };
}
