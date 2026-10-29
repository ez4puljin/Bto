import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListTable, SpacerCell, SpacerHead, TruncateCell } from '@/components/list';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** A box of the given width in px: jsdom lays nothing out, so `clientWidth` is faked. */
function boxOf(px: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
}

const COLUMNS = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'amount', kind: 'money' },
] as const;

function Demo() {
  return (
    <ListTable columns={COLUMNS}>
      <TableHeader>
        <TableRow>
          <TableHead>Код</TableHead>
          <TableHead>Нэр</TableHead>
          <SpacerHead />
          <TableHead className="text-right">Дүн</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>A1</TableCell>
          <TruncateCell text="A very long product name that must be cut" fill />
          <SpacerCell />
          <TableCell className="text-right font-mono">1,000</TableCell>
        </TableRow>
      </TableBody>
    </ListTable>
  );
}

describe('ListTable (ADR-0119)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sizes its columns from the spec in a box wide enough', () => {
    // 7 + 8.5 = 15.5rem fixed, the name 12rem at least: 27.5rem; a 1000px box is 62.5rem.
    boxOf(1000);
    render(<Demo />);
    const table = screen.getByRole('table');
    expect(table).toHaveClass('table-fixed');
    const cols = [...table.querySelectorAll('colgroup > col')].map(
      (col) => (col as HTMLTableColElement).style.width,
    );
    // 35rem spare: 26.25 to the name (3 of 4), 8.75 to the spacer.
    expect(cols).toEqual(['7rem', '38.25rem', '8.75rem', '8.5rem']);
    // Inside a sized table a truncated cell neither caps itself nor takes the spare width.
    const cell = screen.getByText('A very long product name that must be cut');
    expect(cell).toHaveClass('truncate');
    expect(cell).not.toHaveClass('max-w-[24rem]');
    expect(cell.closest('td')).not.toHaveClass('w-full');
  });

  it('keeps the browser layout in a box narrower than the minimum, and before it is measured', () => {
    boxOf(400);
    const { unmount } = render(<Demo />);
    let table = screen.getByRole('table');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.querySelector('colgroup')).toBeNull();
    expect(screen.getByText('A very long product name that must be cut')).not.toHaveClass(
      'max-w-[24rem]',
    );
    expect(screen.getByText('A very long product name that must be cut').closest('td')).toHaveClass(
      'w-full',
    );
    unmount();
    vi.restoreAllMocks();
    render(<Demo />);
    table = screen.getByRole('table');
    expect(table.querySelector('colgroup')).toBeNull();
  });

  it('caps a truncated cell outside a sized table, as before', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TruncateCell text="Long" />
            <TruncateCell text="Fill" fill />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText('Long')).toHaveClass('max-w-[24rem]');
    expect(screen.getByText('Fill').closest('td')).toHaveClass('w-full');
  });
});
