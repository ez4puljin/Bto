import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import './index.css';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { createBrowserApiClient } from '@/lib/api';
import { createQueryClient } from '@/lib/query-client';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <AppProviders apiClient={createBrowserApiClient()} queryClient={createQueryClient()}>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>,
);
