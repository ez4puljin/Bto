import { describe, expect, it } from 'vitest';
import {
  changeOf,
  draftFrom,
  draftKey,
  draftLineOf,
  draftOfDetail,
  emptyDraft,
  removeDraftLine,
  setDraftLine,
  setDraftNote,
} from './draft';
import type { TransferRequestDetail } from './types';

describe('the request draft on the phone (ADR-0116 #1)', () => {
  it('is kept per user, server and store', () => {
    expect(draftKey('http://pc:3300', 9, 149)).toBe('bto.transferDraft.v1:http://pc:3300:9:149');
  });

  it('reads back what was stored for this store, dropping bad lines', () => {
    expect(draftFrom(null, 1)).toEqual(emptyDraft(1));
    expect(draftFrom({ storeId: 2, lines: [], note: 'x' }, 1)).toEqual(emptyDraft(1));
    expect(
      draftFrom(
        {
          storeId: 1,
          lines: [
            { productId: 5, productUnitId: 50, qty: '2' },
            { productId: 6, productUnitId: 60, qty: '0' },
            { productId: 7, productUnitId: 70, qty: 'abc' },
            { productId: 8 },
          ],
          note: 'Хурдан',
        },
        1,
      ),
    ).toEqual({
      storeId: 1,
      lines: [{ productId: 5, productUnitId: 50, qty: '2' }],
      note: 'Хурдан',
    });
  });

  it('adds, changes, removes a product’s line and keeps the note', () => {
    let draft = emptyDraft(1);
    draft = setDraftLine(draft, 5, 50, '2');
    draft = setDraftLine(draft, 6, 60, '1.000');
    expect(draft.lines).toEqual([
      { productId: 5, productUnitId: 50, qty: '2' },
      { productId: 6, productUnitId: 60, qty: '1' },
    ]);
    draft = setDraftLine(draft, 5, 51, '3');
    expect(draftLineOf(draft, 5)).toEqual({ productId: 5, productUnitId: 51, qty: '3' });
    expect(draft.lines[0]?.productId).toBe(5);
    draft = setDraftLine(draft, 6, 60, '0');
    expect(draftLineOf(draft, 6)).toBeUndefined();
    draft = removeDraftLine(draft, 5);
    expect(draft.lines).toEqual([]);
    expect(setDraftNote(draft, 'Маргааш').note).toBe('Маргааш');
  });

  it('takes a server DRAFT’s lines, cancelled groups left out', () => {
    const detail = {
      id: 3,
      destWarehouseId: 149,
      note: null,
      groups: [
        {
          status: 'DRAFT',
          lines: [{ productId: 5, requestUnitId: 50, requestedQty: '2.000' }],
        },
        {
          status: 'CANCELLED',
          lines: [{ productId: 6, requestUnitId: 60, requestedQty: '1.000' }],
        },
      ],
    } as unknown as TransferRequestDetail;
    expect(draftOfDetail(detail)).toEqual({
      storeId: 149,
      lines: [{ productId: 5, productUnitId: 50, qty: '2' }],
      note: '',
    });
  });

  it('describes a cell save with the value the screen opened with', () => {
    const opened = { productId: 5, productUnitId: 50, qty: '2' };
    expect(changeOf(opened, 5, 51, '3')).toEqual({
      productId: 5,
      productUnitId: 51,
      qty: '3',
      previousUnitId: 50,
      previousQty: '2',
    });
    expect(changeOf(opened, 5, 51, '0')).toEqual({
      productId: 5,
      productUnitId: null,
      qty: null,
      previousUnitId: 50,
      previousQty: '2',
    });
    expect(changeOf(undefined, 9, 90, '1')).toEqual({
      productId: 9,
      productUnitId: 90,
      qty: '1',
      previousUnitId: null,
      previousQty: null,
    });
  });
});
