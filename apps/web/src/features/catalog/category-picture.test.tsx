import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageResize from '@/lib/image-resize';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

vi.mock('@/lib/image-resize', async (original) => ({
  ...(await original<typeof ImageResize>()),
  cropToJpeg: vi.fn(() => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))),
}));
vi.mock('@/lib/upload', () => ({ uploadFile: vi.fn(() => Promise.resolve(701)) }));

type Schemas = components['schemas'];

const category = (fields: Partial<Schemas['Category']>): Schemas['Category'] => ({
  id: 1,
  parentId: null,
  name: 'Ус, ундаа',
  defaultClassificationCode: null,
  skuFrom: null,
  skuTo: null,
  productCount: 3,
  childCount: 1,
  imageUrl: null,
  ...fields,
});
const DRINKS = category({});
const SODA = category({ id: 2, parentId: 1, name: 'Газтай ундаа', childCount: 0 });
const KEEPER: Me = {
  ...ADMIN_ME,
  id: 8,
  username: 'keeper',
  fullName: 'Нүүр Сараа',
  permissions: ['customer_app.home.manage'],
  roles: [],
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('a top category’s picture in «Bto300» (ADR-0092 #6)', () => {
  it('offers the picture on top categories only and uploads one square', async () => {
    const fetchMock = signedIn(KEEPER, {
      'GET /api/v1/categories': () => json({ data: [DRINKS, SODA], nextCursor: null }),
      'PUT /api/v1/categories/1/image': () =>
        json({ ...DRINKS, imageUrl: '/api/v1/files/public/c1.jpg' }),
    });
    renderApp('/catalog/categories', fetchMock);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', {
      name: `${mn.catalog.categories.appPicture}: Ус, ундаа`,
    });
    expect(
      screen.queryByRole('button', { name: `${mn.catalog.categories.appPicture}: Газтай ундаа` }),
    ).toBeNull();
    // Without catalog.products.manage the tree's own actions stay away.
    expect(
      screen.queryByRole('button', { name: `${mn.catalog.categories.addChild}: Ус, ундаа` }),
    ).toBeNull();
    await user.click(button);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(mn.catalog.categories.appPictureNone)).toBeInTheDocument();
    await user.upload(
      dialog.getByLabelText(mn.catalog.categories.appPicture),
      new File(['x'], 'drinks.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/categories/1/image')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/categories/1/image')[0])).toEqual({
      imageFileId: 701,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.catalog.categories.appPictureSaved,
    );
  });

  it('shows the picture in the tree and takes it away', async () => {
    const pictured = category({ imageUrl: '/api/v1/files/public/c1.jpg' });
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/categories': () => json({ data: [pictured, SODA], nextCursor: null }),
      'DELETE /api/v1/categories/1/image': () => new Response(null, { status: 204 }),
    });
    renderApp('/catalog/categories', fetchMock);
    const user = userEvent.setup();
    expect(
      await screen.findByRole('img', {
        name: mn.catalog.categories.appPictureOf.replace('{{name}}', 'Ус, ундаа'),
      }),
    ).toHaveAttribute('src', '/api/v1/files/public/c1.jpg');
    await user.click(
      screen.getByRole('button', { name: `${mn.catalog.categories.appPicture}: Ус, ундаа` }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.catalog.categories.appPictureRemove }));
    await waitFor(() =>
      expect(calls(fetchMock, 'DELETE', '/api/v1/categories/1/image')).toHaveLength(1),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.catalog.categories.appPictureRemoved,
    );
  });
});
