# ADR-0152: Accounts and parties are typed into the field, and money shows its thousands as it is typed

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («dialog цонх том болго. Харилцагч болон данс бичиж шууд хайдаг болго … Дүн оруулахад таслал шууд авагддаг байх. 1,000,000 гэсэн форматтай», «Зөвхөн санхүүгийн дэлгэцүүд», 2026-11-05), Claude (the direct-mode session) |

## Decision

1. **`SearchSelect`** (`components/search-select.tsx`) is a form's choice among many: letters go straight into the field and narrow the list, arrows move, Enter takes the row and never saves the form, Esc closes the list and not the dialog. A click or a letter opens it, a dialog's first focus does not. Its list sits in a portal and flips, so a dialog never clips it. Accounts on the finance forms use it, found by code or name.
2. **`CustomerSelect` / `SupplierSelect`** (`features/partners/party-select.tsx`) are the same field over the server's search by name, code, phone or TIN: nothing lists before the first letter, ✕ clears the choice. They replace the pickers on the finance forms only; `CustomerPicker` and `SupplierPicker` stay on every other screen.
3. **`MoneyInput`** (`components/money-input.tsx`) shows `1,000,000` while the page holds the plain `1000000`, so what reaches the API has no commas and nothing passes through a number. It takes digits and one point with at most two decimals, and the caret stays after the same digit. Quantities keep their plain input.
4. **The finance dialogs are wider.** Transactions, payments, settling and the issue accounts are `xl`; a money account is `lg`.
5. **The filter pills on finance lists** (the journal's account, an account ledger's party) use the existing `Combobox`, which is typed in too.
6. By the owner's answer, **«Данс» on «Авлага өглөг» lists that journal's accounts** (12xxxx and 31xxxx together) and **«Харилцсан данс» all but the stock accounts**, as ADR-0150 and ADR-0151 have it. Nothing changes there.

## Consequences

**Positive.** A chart of over a hundred accounts and thousands of customers are reached by a few keys, with no mouse needed.

**Negative.** Two ways to pick a party exist until another screen asks for this one. `SearchSelect` draws every matching row, which suits a chart of accounts and not a product list.

## Related

ADR-0042, ADR-0066, ADR-0150, ADR-0151, docs/ui.md.
