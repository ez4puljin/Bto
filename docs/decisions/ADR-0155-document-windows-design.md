# ADR-0155: One frame for the receipt and issue windows, and a transaction that shows its entry

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («орлого зарлага болон санхүүгийн гүйлгээний цонхнуудын ui/ux загварыг /design ашиглан сайжруулья», 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0119 (`DocumentHeader` gives way to `DocumentWorkspace`), ADR-0081 (the issue window's layout) |

## Decision

No rule, right or posting changes; the look stays ADR-0042's tokens.

1. **`DocumentWorkspace`**: the document on the left, the line editor on the right, the lines below, on the receipt and the issue alike. The issue's scan box, quantity and search stack in the right part.
2. **Less to read before the work.** The new windows drop the page description; the issue's warehouse hint is one line; its recipient says it is required only when it is missing.
3. **The sticky bar sums the receipt**: lines, weight and, for cost holders, the total.
4. **A transaction starts at «Данс»**, not the date; the amount is the largest field; the party's kind stands beside the party instead of a second «Харилцагч» over it; a receivables note is one tinted line.
5. **`PostingPreview`** shows Дт and Кт with the amount before saving, once both accounts and the amount are in. With VAT or city tax ticked it hides, as the entry then has more lines than it can say.
6. **`SegmentedControl`** is as wide as its options, everywhere.
