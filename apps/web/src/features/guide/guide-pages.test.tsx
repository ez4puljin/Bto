import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { findSidebar, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

const COMMAND =
  'irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/install.ps1 | iex';

describe('the guide', () => {
  it('is in the menu for a person without rights', async () => {
    renderApp('/guide', signedIn(WORKER_ME));
    const sidebar = await findSidebar();
    expect(await within(sidebar).findByRole('link', { name: mn.nav.guide })).toBeTruthy();
  });

  it('draws only the categories that have articles, and lists the seven articles', async () => {
    renderApp('/guide', signedIn(WORKER_ME));
    await screen.findByRole('heading', { name: mn.guide.title });
    const withArticles = ['inventory', 'catalog', 'setup'] as const;
    for (const key of withArticles) {
      expect(screen.getByRole('heading', { name: mn.guide.categories[key] })).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: mn.guide.categories.sales })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(withArticles.length);
    const list = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.split('/').length === 4);
    expect(list.filter((link) => link.getAttribute('href')?.startsWith('/guide/'))).toHaveLength(7);
  });

  it('has a row of category links with counts that jump to the cards, hidden while searching', async () => {
    const user = userEvent.setup();
    renderApp('/guide', signedIn(WORKER_ME));
    const nav = await screen.findByRole('navigation', { name: mn.guide.categoryLinks });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      `${mn.guide.categories.inventory}2`,
      `${mn.guide.categories.catalog}2`,
      `${mn.guide.categories.setup}3`,
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#guide-inventory',
      '#guide-catalog',
      '#guide-setup',
    ]);
    for (const link of links) {
      expect(document.getElementById(link.getAttribute('href')?.slice(1) ?? '')).toBeTruthy();
    }
    await user.type(screen.getByRole('searchbox', { name: mn.guide.search }), 'scan');
    expect(screen.queryByRole('navigation', { name: mn.guide.categoryLinks })).toBeNull();
  });

  it('narrows as you type and says when nothing matches', async () => {
    const user = userEvent.setup();
    renderApp('/guide', signedIn(WORKER_ME));
    const box = await screen.findByRole('searchbox', { name: mn.guide.search });
    await user.type(box, 'scan-bridge');
    expect(screen.getByRole('link', { name: /USB scanner/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: mn.guide.categories.catalog })).toBeNull();
    await user.clear(box);
    await user.type(box, 'ЗЭРЭГЛЭЭЭ-ХОЙД');
    expect(screen.getByText(mn.guide.empty)).toBeTruthy();
  });

  it('shows an article with steps, a table and a copyable command, and follows its links', async () => {
    const user = userEvent.setup();
    renderApp('/guide/setup/scan-bridge', signedIn(WORKER_ME));
    await screen.findByRole('heading', { name: /USB scanner-ийн туслах/ });
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(5);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    expect(screen.getByText(COMMAND)).toBeTruthy();
    const copy = screen.getAllByRole('button', { name: mn.guide.copy })[0];
    if (!copy) throw new Error('no copy button');
    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe(COMMAND);
    expect(await screen.findByRole('button', { name: mn.guide.copied })).toBeTruthy();
    expect(screen.getByText(mn.guide.sameCategory)).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Падааныг scanner-аар оруулах' }));
    expect(
      await screen.findByRole('heading', { name: /Падааныг scanner-аар/, level: 1 }),
    ).toBeTruthy();
  });

  it('says so for an address that names no article', async () => {
    renderApp('/guide/setup/nothing-here', signedIn(WORKER_ME));
    expect(await screen.findByText(mn.guide.notFound)).toBeTruthy();
    expect(screen.getByRole('link', { name: mn.guide.backToGuide }).getAttribute('href')).toBe(
      '/guide',
    );
  });
});
