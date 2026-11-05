A short task over the page: a create form, a question, a line editor; `radius-2xl` over a dark overlay.

**Sizes:** `DialogContent size`: `sm` a question or up to 3 fields (default), `md` a one-column form, `lg` two columns or a small table, `xl` a line editor. Never a one-off `sm:max-w-*`.

**Rules:** keep `DialogFooter` last: it sticks to the bottom of a dialog taller than the window. A create dialog opens from the URL (`useCreateParam`, `?new=1`), uses `FormField`s in one column and `DialogFormFooter`. Closing gives the focus back to what opened it. ✕ is «Хаах» unless named. A scan's Enter never presses a button inside.

The first view shows it open without taking the focus; reopened from its button, it is the real modal.
