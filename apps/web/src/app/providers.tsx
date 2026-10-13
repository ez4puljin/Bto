import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ApiClientProvider } from '@/app/api-context';
import { AuthProvider } from '@/app/auth-provider';
import { Toaster } from '@/components/toaster';
import type { AuthSession } from '@/lib/auth/auth-session';
import { i18n } from '@/lib/i18n';

export function AppProviders(props: {
  session: AuthSession;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={props.queryClient}>
        <AuthProvider session={props.session}>
          <ApiClientProvider client={props.session.client}>{props.children}</ApiClientProvider>
        </AuthProvider>
      </QueryClientProvider>
      <Toaster />
    </I18nextProvider>
  );
}
