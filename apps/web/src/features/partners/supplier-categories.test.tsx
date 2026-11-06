import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, type Me, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];

const category = (
  fields: Partial<Schemas['SupplierCategory']> & { id: number; name: string },
): Schemas['SupplierCategory'] => ({
  parentId: null,
  path: fields.name,
  depth: 0,
  active: true,
  sortOrder: 10,
  supplierCount: 0,
  ...fields,
});
const FOOD = category({ id: 1, name: 'Хүнс', supplierCount: 5 });
const DAIRY = category({
  id: 2,
  name: 'Сүүн бүтээгдэхүүн',
  parentId: 1,
  path: 'Хүнс / Сүүн бүтээгдэхүүн',
  depth: 1,
  supplierCount: 3,
});
const CHEESE = category({
  id: 3,
  name: 'Бяслаг',
  parentId: 2,
  path: 'Хүнс / Сүүн бүтээгдэхүүн / Бяслаг',
  depth: 2,
});
const OLD = category({ id: 4, name: 'Хуучин', active: false, sortOrder: 20 });
const ALL = [FOOD, DAIRY, CHEESE, OLD];
const routes = { 'GET /api/v1/supplier-categories': () => json(ALL) };

const READER_ME: Me = { ...WORKER_ME };

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

const SUPPLIER: Schemas['SupplierListItem'] = {
  id: 9,
  code: '101',
  name: 'Сүү ХХК',
  tin: null,
  phone: null,
  vatPayer: false,
  status: 'ACTIVE',
  regNo: null,
  email: null,
  address: null,
  bankName: null,
  bankAccount: null,
  paymentTermDays: null,
  note: null,
  contact: null,
  productCount: 2,
  categoryId: 2,
  categoryPath: 'Хүнс / Сүүн бүтээгдэхүүн',
};

/** Supplier categories (ADR-0161): the tree, a child under its parent, the column and the filter. */
describe('supplier categories', () => {
  it('shows the tree, each name opening its suppliers', async () => {
    renderApp('/partners/supplier-categories', signedIn(ADMIN_ME, routes));
    const dairy = await screen.findByRole('link', {
      name: mn.partners.supplierCategories.showSuppliers.replace(
        '{{name}}',
        'Хүнс / Сүүн бүтээгдэхүүн',
      ),
    });
    expect(dairy).toHaveAttribute('href', '/partners/suppliers?category=2');
    expect(dairy).toHaveTextContent('Сүүн бүтээгдэхүүн');
    expect(screen.getByText(mn.partners.supplierCategories.inactive)).toBeInTheDocument();
  });

  it('adds a child under the row it was asked from', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'POST /api/v1/supplier-categories': () =>
        json(category({ id: 7, name: 'Тараг', parentId: 2, depth: 2 }), 201),
    });
    renderApp('/partners/supplier-categories', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: mn.partners.supplierCategories.addChild.replace('{{name}}', 'Сүүн бүтээгдэхүүн'),
      }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(mn.partners.supplierCategories.parent)).toHaveValue('2');
    await user.type(dialog.getByLabelText(mn.partners.supplierCategories.name), 'Тараг');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [posted] = calls(fetchMock, 'POST', '/api/v1/supplier-categories');
    expect(await posted?.clone().json()).toEqual({ name: 'Тараг', parentId: 2 });
    expect(posted?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('never offers a category or what is below it as its own parent', async () => {
    renderApp('/partners/supplier-categories', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: mn.common.editRecord.replace('{{name}}', 'Сүүн бүтээгдэхүүн'),
      }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    const parent = dialog.getByLabelText(mn.partners.supplierCategories.parent);
    expect(parent).toHaveValue('1');
    expect(
      within(parent)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([mn.partners.supplierCategories.noParent, 'Хүнс']);
  });

  it('retires one and brings one back', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'PATCH /api/v1/supplier-categories/4': () => json({ ...OLD, active: true }),
    });
    renderApp('/partners/supplier-categories', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: mn.partners.supplierCategories.reactivate.replace('{{name}}', 'Хуучин'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/supplier-categories/4')).toHaveLength(1),
    );
    const [patched] = calls(fetchMock, 'PATCH', '/api/v1/supplier-categories/4');
    expect(await patched?.clone().json()).toEqual({ active: true });
  });

  it('lets a reader see the tree without changing it', async () => {
    renderApp('/partners/supplier-categories', signedIn(READER_ME, routes));
    expect(await screen.findByText('Хүнс')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: mn.partners.supplierCategories.create }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: mn.partners.supplierCategories.retire.replace('{{name}}', 'Хүнс'),
      }),
    ).toBeNull();
  });

  it('shows the category in the supplier list and filters by it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'GET /api/v1/suppliers': () => json({ data: [SUPPLIER], nextCursor: null }),
    });
    renderApp('/partners/suppliers', fetchMock);
    const user = userEvent.setup();
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Хүнс / Сүүн бүтээгдэхүүн')).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: mn.partners.suppliers.columns.category }),
    ).toBeInTheDocument();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: mn.partners.supplier.category }),
      '1',
    );
    await waitFor(() => {
      const last = calls(fetchMock, 'GET', '/api/v1/suppliers').at(-1);
      expect(new URL(last?.url ?? '').searchParams.get('categoryId')).toBe('1');
    });
  });

  it('filters by a product category and shows the products of a count in brief', async () => {
    const PRODUCT_CATEGORIES = [
      {
        id: 8,
        parentId: null,
        name: 'Гурил, будаа',
        code: null,
        skuFrom: null,
        skuTo: null,
        productCount: 3,
        imageUrl: null,
        defaultClassificationCode: null,
      },
    ];
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'GET /api/v1/categories': () => json({ data: PRODUCT_CATEGORIES, nextCursor: null }),
      'GET /api/v1/suppliers': () => json({ data: [SUPPLIER], nextCursor: null }),
      'GET /api/v1/suppliers/9/products': () =>
        json({
          data: [
            {
              linkId: 1,
              isMain: true,
              product: {
                id: 71,
                sku: '7001',
                name: 'Улаан буудайн гурил',
                categoryId: 8,
                status: 'ACTIVE',
                thumbUrl: null,
                baseUnitName: 'ш',
              },
            },
          ],
          nextCursor: null,
        }),
      'GET /api/v1/product-prices/current': () =>
        json([
          {
            productId: 71,
            warehousePrice: '2500',
            profileId: 1,
            profileName: 'Үндсэн',
            wholeUomId: null,
          },
        ]),
    });
    const { router } = renderApp('/partners/suppliers', fetchMock);
    const user = userEvent.setup();
    const filter = await screen.findByRole('combobox', {
      name: mn.partners.suppliers.productCategory,
    });
    await user.click(filter);
    await user.click(await screen.findByRole('option', { name: 'Гурил, будаа' }));
    await waitFor(() => {
      const last = calls(fetchMock, 'GET', '/api/v1/suppliers').at(-1);
      expect(new URL(last?.url ?? '').searchParams.get('productCategoryId')).toBe('8');
    });
    expect(router.state.location.search).toBe('?productCategory=8');

    // Read only once opened, of that category; the row does not open.
    expect(calls(fetchMock, 'GET', '/api/v1/suppliers/9/products')).toHaveLength(0);
    await user.click(
      await screen.findByRole('button', {
        name: mn.partners.suppliers.brief.open
          .replace('{{name}}', 'Сүү ХХК')
          .replace('{{count}}', '2'),
      }),
    );
    expect(await screen.findByText('Улаан буудайн гурил')).toBeInTheDocument();
    expect(await screen.findByText('2,500₮')).toBeInTheDocument();
    expect(screen.getByText(mn.partners.supplier.main)).toBeInTheDocument();
    const [read] = calls(fetchMock, 'GET', '/api/v1/suppliers/9/products');
    expect(new URL(read?.url ?? '').searchParams.get('productCategoryId')).toBe('8');
    expect(screen.getByRole('link', { name: mn.partners.suppliers.brief.all })).toHaveAttribute(
      'href',
      '/catalog/products?supplier=9&category=8',
    );
    await user.click(screen.getByText('7001'));
    expect(router.state.location.pathname).toBe('/partners/suppliers');
  });

  it('filters from the left side, a box finding a product category by name', async () => {
    const PRODUCT_CATEGORIES = [
      {
        id: 8,
        parentId: null,
        name: 'Гурил, будаа',
        defaultClassificationCode: null,
        skuFrom: null,
        skuTo: null,
        productCount: 3,
        childCount: 1,
        imageUrl: null,
      },
      {
        id: 76,
        parentId: 8,
        name: '702 Нарийн гурил',
        defaultClassificationCode: null,
        skuFrom: null,
        skuTo: null,
        productCount: 2,
        childCount: 0,
        imageUrl: null,
      },
      {
        id: 9,
        parentId: null,
        name: 'Амттан',
        defaultClassificationCode: null,
        skuFrom: null,
        skuTo: null,
        productCount: 4,
        childCount: 0,
        imageUrl: null,
      },
    ];
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'GET /api/v1/categories': () => json({ data: PRODUCT_CATEGORIES, nextCursor: null }),
      'GET /api/v1/segments': () => json({ data: [], nextCursor: null }),
      'GET /api/v1/suppliers': () => json({ data: [SUPPLIER], nextCursor: null }),
    });
    const { router } = renderApp('/partners/suppliers', fetchMock);
    const user = userEvent.setup();
    const panel = within(
      await screen.findByRole('complementary', { name: mn.partners.suppliers.panel.label }),
    );
    const products = within(
      panel.getByRole('region', { name: mn.partners.suppliers.productCategory }),
    );
    // A parent counts what is below it, and its branch opens.
    await products.findByRole('button', { name: /Гурил, будаа/, pressed: false });
    expect(
      products.getByRole('button', { name: /Гурил, будаа/, pressed: false }),
    ).toHaveTextContent('5');
    await user.type(
      products.getByRole('searchbox', { name: mn.partners.suppliers.panel.findCategory }),
      'нарийн',
    );
    expect(products.queryByRole('button', { name: /Амттан/ })).toBeNull();
    await user.click(products.getByRole('button', { name: /Нарийн гурил/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?productCategory=76'));
    await waitFor(() => {
      const last = calls(fetchMock, 'GET', '/api/v1/suppliers').at(-1);
      expect(new URL(last?.url ?? '').searchParams.get('productCategoryId')).toBe('76');
    });

    // Their own category and status, from the same side.
    const own = within(
      panel.getByRole('region', { name: mn.partners.suppliers.panel.supplierCategory }),
    );
    await user.click(await own.findByRole('button', { name: /Хүнс/, pressed: false }));
    await user.click(panel.getByRole('button', { name: mn.partners.status.INACTIVE }));
    await waitFor(() => {
      const last = calls(fetchMock, 'GET', '/api/v1/suppliers').at(-1);
      const query = new URL(last?.url ?? '').searchParams;
      expect(query.get('categoryId')).toBe('1');
      expect(query.get('status')).toBe('INACTIVE');
    });
    // A retired category is not offered here.
    expect(own.queryByRole('button', { name: /Хуучин/ })).toBeNull();
  });
});
