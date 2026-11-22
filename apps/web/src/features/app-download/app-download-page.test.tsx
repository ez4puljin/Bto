import { screen } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { json, renderApp, signedOut } from '@/test/render-app';

describe('app download page', () => {
  it('shows both apps with version, size and a plain download link without signing in', async () => {
    renderApp(
      '/download',
      signedOut({
        'GET /api/v1/app-releases/staff': () =>
          json({ release: { version: '1.2.3', versionCode: 12, sizeBytes: 80_424_960 } }),
        'GET /api/v1/app-releases/customer': () => json({ release: null }),
      }),
    );
    expect(await screen.findByText(mn.appDownload.staff.title)).toBeInTheDocument();
    expect(screen.getByText(mn.appDownload.customer.title)).toBeInTheDocument();
    expect(await screen.findByText(/1\.2\.3/)).toHaveTextContent('76.7 MB');
    const link = screen.getByRole('link', { name: mn.appDownload.download });
    expect(link).toHaveAttribute('href', '/api/v1/app-releases/staff/apk');
    expect(link).toHaveAttribute('download');
    expect(await screen.findByText(mn.appDownload.none)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: mn.appDownload.download })).toHaveLength(1);
  });
});
