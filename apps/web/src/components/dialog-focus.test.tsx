import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/** A dialog that stays mounted and opens from a plain button, like the app's create dialogs. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
          <DialogDescription>description</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('dialog focus (ADR-0066)', () => {
  it('gives the focus back to the button that opened it, every time it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    for (let round = 0; round < 2; round += 1) {
      await user.click(opener);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(opener).toHaveFocus();
    }
  });
});
