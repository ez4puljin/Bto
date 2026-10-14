import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { i18n } from '@/lib/i18n';

const ask = (variant: 'default' | 'destructive', onConfirm: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ConfirmDialog
        open
        variant={variant}
        title="Батлах уу?"
        confirmLabel="Батлах"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />
    </I18nextProvider>,
  );

describe('confirmation dialogs (ADR-0047 #3, #4)', () => {
  it('gives a posting step its main button, so Enter confirms', async () => {
    const onConfirm = vi.fn();
    ask('default', onConfirm);
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Батлах' })).toHaveFocus());
    await userEvent.setup().keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('never lets a barcode scan press the focused button', async () => {
    const onConfirm = vi.fn();
    ask('default', onConfirm);
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Батлах' })).toHaveFocus());
    // A scanner types the code in a burst and ends it with Enter.
    await userEvent.setup({ delay: null }).keyboard('4006381333931{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps «Болих» first in line before a destructive step', async () => {
    const onConfirm = vi.fn();
    ask('destructive', onConfirm);
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: mn.common.cancel })).toHaveFocus(),
    );
    await userEvent.setup().keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
