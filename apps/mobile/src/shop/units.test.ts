import { describe, expect, it } from 'vitest';
import { baseQty, baseUnitOf, defaultUnitOf, knownUnit, packOf, shortBy } from './units';

const pcs = { id: 1, uomName: 'ш', uomCode: 'PCS', factorToBase: '1', isBase: true };
const block = { id: 2, uomName: 'блок', uomCode: 'BLOCK', factorToBase: '10', isBase: false };
const box = { id: 3, uomName: 'хайрцаг', uomCode: 'BOX', factorToBase: '24', isBase: false };

describe('shop units', () => {
  it('knows the system units only', () => {
    expect(knownUnit('BOX')).toBe('BOX');
    expect(knownUnit('BAG')).toBeNull();
    expect(knownUnit(null)).toBeNull();
  });

  it('tells a product by its default sales pack, else its largest pack', () => {
    expect(packOf([pcs, block, box])?.id).toBe(3);
    expect(packOf([pcs, { ...block, isDefaultSales: true }, box])?.id).toBe(2);
    expect(packOf([pcs])).toBeUndefined();
    expect(baseUnitOf([box, pcs])?.id).toBe(1);
  });

  it('adds by the default sales unit, else the largest pack, else pieces', () => {
    expect(defaultUnitOf([{ ...pcs, isDefaultSales: true }, box])?.id).toBe(1);
    expect(defaultUnitOf([pcs, block, box])?.id).toBe(3);
    expect(defaultUnitOf([pcs])?.id).toBe(1);
  });

  it('counts base units and what goes short of the stock', () => {
    expect(baseQty(3, box).toFixed()).toBe('72');
    expect(shortBy(baseQty(3, box), '70').toFixed()).toBe('2');
    expect(shortBy(baseQty(2, box), '70').toFixed()).toBe('0');
    expect(shortBy(baseQty(1, pcs), '-5').toFixed()).toBe('6');
  });
});
