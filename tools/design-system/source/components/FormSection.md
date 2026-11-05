Settings-style forms: titled sections of rows, the label left and the field right where the row is wide enough.

**Parts:** `FormSection({ title, description, action, step, plain })`, `FormRow({ label, htmlFor, hint, error, align })` (label in `form-label`; stacked below 28rem by container query), `FormField` (label over field, for dialogs), `FormFooter` (a page's form), `DialogFormFooter({ pending, onCancel, submitLabel, disabled })`.

**Rules:** «Болих» (ghost) then the main button, on the right. `FormRow` and `FormField` give their hint and error the ids `<htmlFor>-hint` and `<htmlFor>-error` and point the control to them, so a caller only sets `htmlFor`. Server refusals that belong to a field show on that field, the others in a `ProblemAlert` above the footer.

**Don't** put a `FormFooter` inside a dialog, or a create form above a list.
