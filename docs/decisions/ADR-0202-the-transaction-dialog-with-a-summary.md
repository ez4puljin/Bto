# ADR-0202: «Шинэ гүйлгээ» asks in the order of the work and sums up beside the fields

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-16 |
| Deciders | Owner (2026-11-16: «орлого цонх layout өөрчлөх хэрэгтэй байна», chose the third of three drawn layouts: «В хувилбарыг сонголоо», then «Тийм, тавь»), Claude (the direct-mode session) |
| Amends | ADR-0155 (where the work starts, where the entry's two sides show), ADR-0201 #5 (the worked example), ADR-0150 (the form's words for cash and bank) |

## Context

ADR-0201 made «Шинэ гүйлгээ» fit its screens. The owner then asked for another layout and for a critique of the one that stood. It was an accountant's form in an accountant's order: its title was the journal («Харилцах»), so the window did not say what it was doing; «Орлого / Зарлага», its most important choice, was one field among eight and looked the same either way; «Данс» and «Харилцсан данс» did not say which is the money and which the reason; the amount stood third, the size of every other field; the date, almost always today, had the first place; the balance was a grey line of 12px and the entry's two sides two cut lines beside the buttons. Three layouts were drawn (one column in the order of the questions; the money's way from one box to another; fields on the left with a summary on the right) and the owner chose the third.

## Decision

1. **Two parts.** The fields on the left, a summary («Хураангуй») on the right, from 36rem of the form's own width; the fields pair up from 48rem and stand in one column under it (a tablet upright). The dialog is size `xl`.
2. **The order of the work.** In or out (the whole width) → how much (a field 3rem high, 1.25rem figures) → the two accounts → what for and when → who. The focus starts at the amount.
3. **Words for cash and bank.** The title is «Орлого · Харилцах» or «Зарлага · Харилцах» and follows the choice. The accounts are «Мөнгөний данс» and «Юуны орлого» / «Юуны зарлага». The other journals keep «Данс» and «Харилцсан данс» and their own choice («Үүсгэх / Хаах», «Дебет / Кредит»). The form's one-line description is for a screen reader only.
4. **Money in is green, money out red**: the chosen segment (`SegmentedControl tone`), the amount's figures and the balance after. Only for cash and bank; a debt made or a debit is neither good nor bad news.
5. **The summary** holds what comes and goes while the form is filled, so no field moves (ADR-0201 #3): the account's whole name, its balance now and after this entry (Σ debit − Σ credit, plus a debit, less a credit), the two tax ticks, and the entry's two sides with names on up to two lines. Empty, it says what will show there.
6. **The buttons stand at the foot of the summary**, under what they write, full width: «Хадгалах», «Хадгалаад шинэ», «Болих» (the owner, 2026-11-16: «товчнуудыг хураангуй руу зөө»; the first build had kept them in the footer, as in every other dialog). The dialog has no footer.
7. **The amount carries «₮»** after its figures, inside the field and not part of its value (`MoneyInput suffix`).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One column in the order of the questions | Clearest to read, but the tallest: it only just fits a laptop's 633px, and the owner chose otherwise. |
| The money's way drawn as two boxes and an arrow | Unusual, and cramped on a tablet 768px wide. |
| The buttons in the footer, as in every other dialog | Built first; the owner asked for the drawing's place. This dialog alone has its buttons elsewhere. |

## Consequences

**Positive.** The window says what it does, the choice that cannot be undone by reading is coloured, and the balance after the entry is read before saving. **Negative.** The dialog is wider (56rem, or the window less a margin). The balance after is the account's as of today, whatever date is typed. With a tax tick the entry's sides are not shown (as before): the split is the server's.

## Related

ADR-0150, ADR-0151, ADR-0155, ADR-0201, `apps/web/src/features/finance/transaction-dialog.tsx`, `components/list.tsx` (`SegmentedControl tone`), `docs/ui.md` §0.
