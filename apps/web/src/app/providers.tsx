import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ApiClientProvider } from '@/app/api-context';
import type { ApiClient } from '@/lib/api';
import { i18n } from '@/lib/i18n';

export function AppProviders(props: {
  apiClient: ApiClient;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={props.queryClient}>
        <ApiClientProvider client={props.apiClient}>{props.children}</ApiClientProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
