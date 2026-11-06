# ADR-0151: What was typed in a dialog is not lost by accident, «Хадгалаад шинэ», and a transfer between accounts

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Бусад бүх dialog дээр энэ сайжруулалт зэрэг орсон байх ёстой», «Гүйлгээ бүрт дээр нэг данснаас нөгөө дансруу шилжүүлэг хийх боломжтой болго», and the answers to the questions on them, 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0150 (the party is always asked, transfers) |

## Decision

1. **Every dialog guards its fields.** `DialogContent` notices the first use of a field. From then on a click outside does nothing, and ✕, Esc and «Болих» ask «Бөглөсөн мэдээллийг устгах уу?». Saving closes as before. A picker's search does not count, questions (`ConfirmDialog`) pass `guard={false}`, and a dialog that knows better passes `dirty`. It sits in the one component, so no dialog can forget it. «Болих» is recognised by its word on a button that is not a submit.
2. **«Хадгалаад шинэ»** saves and stays for the next one, on the forms typed in a row: transactions and payments (keeping the date, the accounts and the kind), new employees (keeping the division, schedule and kind of employment), new customers and suppliers (a clean form with the next code). Product registration already works this way, keeping category, supplier and warehouse. Each save takes its own idempotency key.
3. **«Шилжүүлэг»** on every tab of «Гүйлгээ» but «Бараа материал»: from an account of that journal to any active account outside the stock journal, a date, an amount and a description. It is one balanced manual entry through ADR-0150's route: the side that shrinks the first account, the counter side on the other. Same-journal, cross-journal and party accounts all work; a party account asks for its party, each side its own. By the owner's answer: no fee, no exchange rate, no printed voucher, no courier.
4. **The party is always offered on a new transaction** (Erkhet shows it always), below the amount because its list is long: required on «Авлага өглөг» and wherever an account needs one, optional elsewhere, stored on the line when given. A transfer asks it only when an account needs one.

## Consequences

**Positive.** A long form cannot vanish on a stray click, in any dialog, present or future.

**Negative.** «Болих» by its word is a convention: a dialog that names its cancel otherwise closes without asking. A USD account's transfer still books the typed tugriks (ADR-0149 #5).

## Related

ADR-0042, ADR-0066, ADR-0149, ADR-0150, docs/ui.md.
