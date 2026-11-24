import type { QueryClient } from '@tanstack/react-query';

const clients = new Set<QueryClient>();

/** Keep only the clients owned by renderApp; their cache stays intact during each test. */
export function registerQueryClient(client: QueryClient): QueryClient {
  clients.add(client);
  return client;
}

/** Run after React unmounts observers, so inactive query caches and GC timers can be released. */
export function clearQueryClients(): void {
  for (const client of clients) client.clear();
  clients.clear();
}
