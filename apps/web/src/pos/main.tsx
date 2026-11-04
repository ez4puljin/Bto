import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { i18n } from '@/lib/i18n';
import { tillFromAddress } from './address';
import { KioskApp } from './app';
import { EdgeClient, KioskCredentials } from './edge-client';
import { createKioskQueryClient } from './queries';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');
document.title = i18n.t('posKiosk.title');

const addressTill = tillFromAddress(window.location);
const credentials = new KioskCredentials(undefined, addressTill);
const client = new EdgeClient(credentials);

createRoot(container).render(
  <StrictMode>
    <KioskApp
      services={{ client, credentials, addressTill }}
      queryClient={createKioskQueryClient()}
    />
  </StrictMode>,
);
