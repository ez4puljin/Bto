# ADR-0043: Settings-style forms, switches and row actions

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0042 (#6: lists edited in dialogs keep their row actions, now as icon buttons; #7: a read-first card reads in the form's rows) |
| Amended by | ADR-0047 (#3: a confirmation of the default kind gives its main button the focus, so Enter confirms) |

## Context

After the first UI session (ADR-0042), the owner asked on 2026-10-13 for a more professional product edit form and for the same on the other «Бараа» screens. The edit form was a narrow card with two loose columns of fields and the save button on the left. Each unit of a product repeated an input and four or five buttons. Category, brand and unit-of-measure rows carried two or three text buttons each. Dialogs had only «Хадгалах», on the left.

## Decision

1. **Forms read like settings** (`components/form.tsx`).
   - `FormSection` groups rows in a hairline box under a small uppercase title, with an optional hint and a header action.
   - `FormRow` puts the label in an 11rem column on the left and the field on the right, with the hint and the error under the field.
     - Phones stack the label and the field.
     - `align="center"` keeps a switch or a short control at the end of its label's line, also on phones.
   - `FormField` (label over field) serves dialogs and narrow places.
   - `FormFooter` ends a form with «Болих» (ghost), then the main button, on the right.
   - `FieldList`, the read view of a `DetailCard`, uses the same rows, so a card keeps its shape when «Засах» opens its form.
2. **On/off values are switches** (`components/ui/switch.tsx`, Radix Switch, green `--toggle` when on): a product's status, default units, fractional units, «include subcategories». Checkboxes stay for choices in a list.
3. **Dialogs** stack their fields and end with «Болих», then the main button. `DialogFooter`'s own close button now comes first, so confirmation dialogs follow the same order.
4. **Row actions.**
   - Rows of lists edited in dialogs carry quiet icon buttons instead of text buttons: `RowActions`, `RowAction` and `RowActionSpacer` in `components/list.tsx`.
     - Each icon button is named for screen readers and shows the same text as a tooltip.
     - The spacer keeps each action in its own column down the list.
     - So far: categories and units of measure.
   - Sub-items with several actions, such as a product's units, show the frequent action as an icon button and the rest in a «⋯» menu named «{item}: үйлдэл», with destructive items last.
   - A dialog opened from either button gives the focus back to the button that opened it.
5. **The product page** shows the primary photo and «SKU · category · status» in its header. Units are rows with tagged barcodes and an add-barcode dialog (scan, type, or issue an internal code). Photos form a square grid whose actions show on hover or focus.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Text buttons on the rows of master lists and units | Three or four buttons per row were the clutter the owner named. Icons with names and tooltips, plus a «⋯» menu for the rarer actions, keep everything one or two clicks away |
| Checkboxes for single on/off values | A switch reads as a setting, is a larger target on phones and keeps its label |
| A form library with its own layout components | `react-hook-form` and the shadcn primitives already cover state and inputs; the layout is about 100 lines |

## Consequences

- Every new form uses `FormSection` / `FormRow` and switches; `docs/ui.md` §4 describes the patterns.
- Modules other than the catalog keep their old forms until the second UI session moves them (STATUS).
- Icon-only buttons need a name and a tooltip; tests find them by that name.

## Related

ADR-0042, `docs/ui.md`, `docs/modules/catalog.md` §8.
