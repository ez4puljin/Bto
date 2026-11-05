import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@tugeel/shared/auth';
import { MemoryRouter } from 'react-router';
import { AuthSessionContext } from '@/app/auth-context';

// A signed-in test user holding every right, so the menus show whole. No server behind it.
const state = {
  status: 'authenticated',
  me: {
    id: 1,
    fullName: 'Туршилтын хэрэглэгч',
    phone: '+97699000000',
    permissions: [...PERMISSIONS],
  },
};

const session = {
  subscribe: () => () => undefined,
  getSnapshot: () => state,
  logout: async () => undefined,
};

const queryClient = new QueryClient();

/**
 * What the app's providers give a screen: a router (in memory, so a link moves nothing outside
 * the preview), the signed-in user and a query client.
 */
export function BtoProvider({ route = '/', children }) {
  return (
    <AuthSessionContext.Provider value={session}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </AuthSessionContext.Provider>
  );
}
