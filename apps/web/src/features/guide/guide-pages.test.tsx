import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { findSidebar, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import { ARTICLES, articlePath, GUIDE_CATEGORIES } from './content';

/** The categories that have at least one article, in order, each with its count. */
const DRAWN = GUIDE_CATEGORIES.flatMap((key) => {
  const count = ARTICLES.filter((article) => article.category === key).length;
  return count > 0 ? [{ key, count }] : [];
});

const COMMAND =
  'irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/install.ps1 | iex';

describe('the guide', () => {
  it('is in the menu for a person without rights', async () => {
    renderApp('/guide', signedIn(WORKER_ME));
    const sidebar = await findSidebar();
    expect(await within(sidebar).findByRole('link', { name: mn.nav.guide })).toBeTruthy();
  });

  it('draws only the categories that have articles, and lists every article', async () => {
    renderApp('/guide', signedIn(WORKER_ME));
    await screen.findByRole('heading', { name: mn.guide.title });
    for (const { key } of DRAWN) {
      expect(screen.getByRole('heading', { name: mn.guide.categories[key] })).toBeTruthy();
    }
    for (const key of GUIDE_CATEGORIES) {
      if (DRAWN.some((drawn) => drawn.key === key)) continue;
      expect(screen.queryByRole('heading', { name: mn.guide.categories[key] }), key).toBeNull();
    }
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(DRAWN.length);
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/guide/') && href.split('/').length === 4);
    expect(hrefs).toEqual(ARTICLES.map(articlePath));
  });

  it('has a row of category links with counts that jump to the cards, hidden while searching', async () => {
    const user = userEvent.setup();
    renderApp('/guide', signedIn(WORKER_ME));
    const nav = await screen.findByRole('navigation', { name: mn.guide.categoryLinks });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      DRAWN.map(({ key, count }) => `${mn.guide.categories[key]}${count}`),
    );
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      DRAWN.map(({ key }) => `#guide-${key}`),
    );
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
    const target = ARTICLES.find((article) => !/[{[]/.test(article.title));
    if (!target) throw new Error('no article with a typeable title');
    await user.click(box);
    await user.paste(target.title);
    const needle = target.title.trim().toLowerCase();
    const expected = ARTICLES.filter((article) => article.searchText.includes(needle));
    expect(expected.length).toBeGreaterThan(0);
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/guide/') && href.split('/').length === 4);
    expect(hrefs).toEqual(expected.map(articlePath));
    await user.clear(box);
    await user.paste('ЗЭРЭГЛЭЭЭ-ХОЙД');
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
