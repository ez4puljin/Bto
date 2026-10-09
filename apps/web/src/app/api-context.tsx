import type { ReactNode } from 'react';
import { ApiClientContext } from '@/app/api-client-context';
import type { ApiClient } from '@/lib/api';

export function ApiClientProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  return <ApiClientContext value={client}>{children}</ApiClientContext>;
}
