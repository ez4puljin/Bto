import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, renderApp, signedIn } from '@/test/render-app';
import { NEWS } from './news';

// This file alone turns the dialog on (`src/test/setup.ts` keeps it shut everywhere else).
vi.mock('@/lib/features', () => ({
  BINS_SOON: false,
  EBARIMT_PER_PRODUCT: true,
  NEWS_DIALOG: true,
}));

describe('news', () => {
  it('shows the unread news on sign-in and not again once read', async () => {
    const user = userEvent.setup();
    const newest = NEWS[0];
    if (!newest) throw new Error('no news shipped');
    // Everything but the newest entry was read in this browser before.
    window.localStorage.setItem(
      `bto.news.read.${ADMIN_ME.id}`,
      JSON.stringify(NEWS.slice(1).map((entry) => entry.id)),
    );
    renderApp('/', signedIn());
    const dialog = await screen.findByRole('dialog', { name: mn.news.dialogTitle });
    expect(within(dialog).getByRole('heading', { name: newest.title })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('article')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: mn.news.gotIt }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(`bto.news.read.${ADMIN_ME.id}`) ?? '[]')).toEqual(
      NEWS.map((entry) => entry.id),
    );

    cleanup();
    renderApp('/', signedIn());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists every entry on its page', async () => {
    window.localStorage.setItem(
      `bto.news.read.${ADMIN_ME.id}`,
      JSON.stringify(NEWS.map((e) => e.id)),
    );
    renderApp('/news', signedIn());
    expect(
      await screen.findByRole('heading', { name: mn.news.title, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(NEWS.length);
  });
});
