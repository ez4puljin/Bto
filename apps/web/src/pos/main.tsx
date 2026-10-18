import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { i18n } from '@/lib/i18n';
import { KioskApp } from './app';
import { EdgeClient, KioskCredentials } from './edge-client';
import { createKioskQueryClient } from './queries';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');
document.title = i18n.t('posKiosk.title');

const credentials = new KioskCredentials();
const client = new EdgeClient(credentials);

createRoot(container).render(
  <StrictMode>
    <KioskApp services={{ client, credentials }} queryClient={createKioskQueryClient()} />
  </StrictMode>,
);
