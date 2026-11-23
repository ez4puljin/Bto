# ADR-0238: «Ашгийн самбар» reads operating expenses, other income and tax from the books

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-23 |
| Deciders | Owner (2026-11-23: «Зардлыг Bto дээр шууд бүртгэдэг болгоё. Гэхдээ мөнгөн хөрөнгө одоо байгаа гүйлгээгээр хийдэг байна.»), Claude (a brain task, `task/board-expenses`) |
| Extends | ADR-0237 (the profit board). Supersedes nothing |

## Context

ADR-0237 built «Ашгийн самбар» to the gross profit and the suppliers' discounts and left the operating expenses, taxes and net profit to a later phase. The owner decided that expenses are recorded in Bto directly, through the money transactions that already exist — «Санхүү → Гүйлгээ» (Касс / Харилцах «Зарлага»), «Журнал», «Банкны хуулга хаах», «Төлбөр → Зарлага» — which already take any expense account as the counter account. Bto's own postings (goods issues, stock losses, loyalty points) already land on expense accounts of class 7. So the board only has to read the books.

## Decision

1. **Read, never write.** The board reads the Finance Core's journal through views of schema `reporting` (migration `0122_reporting_ledger`, SQL only, SELECT to `app`, nothing to `ai_reader`): `reporting.ledger_lines` — every posted journal line on an INCOME or EXPENSE account with its company code, entry, business date, document number and source, description, account, group, Bto branch and party, `amount` signed so an expense is positive on EXPENSE accounts and an income positive on INCOME accounts — and `reporting.ledger_accounts` / `reporting.ledger_groups` (the chart and its tree, ADR-0148). No screen of the finance module, no `fin` table or grant changes; the reporting module names no `fin` relation in its code.
2. **The year close does not count; reversals do.** The year close into retained earnings (ADR-0105, documents `YEAR_CLOSE`) and its reversals are left out of the view, as the income statement leaves them out, or every closed year would read zero. Any other reversal nets its original out on its own date, as the books have it.
3. **Where an account counts is where СТ-2 puts it** (`boardLedgerPart`, `@tugeel/shared/reports`, over `packages/shared/src/finance/statements.ts`: the accountant's link first, the code prefixes otherwise) — one mapping for the statement and the board:
   - **«Урсгал зардал»** (operating expenses) = EXPENSE accounts on the selling, general, finance and other expense rows I9–I12 (class 7), including Bto's stock-issue and stock-loss accounts (7302xx, 730301, 740201, 702007);
   - **«Бусад орлого»** = INCOME accounts off the sales row I1 (511020, 511030, 511040 …);
   - **«Татвар»** = 910101 «Орлогын татварын зардал» (or an account the accountant links to I19);
   - **never from the books**: the sales row I1 (510101, 520101, 520201, and 520202 «Худалдан авалтын хөнгөлөлт», which the board already takes from the receipts, ADR-0237 #5) and the cost row I2 (610101, 610301) — the board's sales and cost stay the sales lines' figures, so nothing is counted twice — and EXPENSE accounts on the gain and loss rows I13–I17, among them 910201 «Тайлант үеийн ашиг (алдагдал)», a result account.
4. **The figures.** «Үйл ажиллагааны ашиг» = gross profit + supplier discounts + other income − operating expenses; «Цэвэр ашиг» = operating profit − tax. The periods and comparisons are ADR-0237's, by the entry's business date; the books are read live (not through `mv_sales_daily`). The trend gains the net profit of each period.
5. **The expense tree** follows the chart's groups (`parent_id`) down to the account: a top-level row is the highest group whose every account is an operating expense, opened to its sub-groups when it holds no account of its own (the class heading «Зардал»); an account whose group holds other accounts too (Bto's «BTO» group) keeps that group as its top row; an account without a group stands under «Бүлэггүй данс». Each row: the amount, its share of the operating expenses, the period before and a year earlier. A row opens its journal lines (date, number, description, account, party, branch, amount), newest first, 500 and `more`.
6. **Branches.** With a branch chosen only the lines of that `branch_id` count. Lines without a branch are «Нийтлэг зардал»: shown as their own figure, not subtracted from the branch's operating or net profit, never silently dropped. Today manual transactions carry no branch, so all of them are «Нийтлэг» until a later task adds the branch to the money transactions; goods issues already carry their warehouse's branch.
7. **Source filter.** Under «Бөөний» or «Супермаркет» the expenses, other income, tax, operating and net profit are not shown (null), as the discounts are (ADR-0237 #5): an expense belongs to no sales channel.
8. **API and page.** `GET reports/profit-board` gains `results` (the three periods), `expenses` (the tree, the totals, `common`, the period's line count) and the trend's `netProfit`; `GET reports/profit-board/expense-entries?…&rowKind=GROUP|ACCOUNT|NONE|COMMON&id` lists a row's lines (none under a source filter, #7); both `reports.margins.view`, read-only, behind the report gate. The page adds the tiles «Урсгал зардал» (with «Энэ хугацаанд зардал бүртгэгдээгүй» when the period has no expense line, so nobody reads the gross profit as net), «Үйл ажиллагааны ашиг», «Цэвэр ашиг»; the waterfall runs Цэвэр борлуулалт → − Өртөг → Нийт ашиг → + Нийлүүлэгчийн хөнгөлөлт → + Бусад орлого → − Урсгал зардал → Үйл ажиллагааны ашиг → − Татвар → Цэвэр ашиг; and a card «Урсгал зардал» under it.

## Alternatives considered

| Alternative | Why not |
|---|---|
| An expense form of the board's own | The owner wants the money to move through the existing transactions; a second entry point would split the books. |
| Read `fin` tables from the reporting service | The Finance Core boundary (finance-core.md §3.2 rule 7): only migrations name `fin` relations; the module reads through its views, as `ap_entries` does. |
| A second account mapping for the board | The income statement already maps every account (with the accountant's links); two mappings would drift. |
| Subtract the branch-less expenses from each branch | No rule divides them yet; dropping or spreading them silently would misstate a branch. They stand apart as «Нийтлэг». |
| Count the class 6 cost and the sales accounts from the books | The board's sales and cost are the sales lines' (ADR-0237 #2); reading them again would count them twice. |

## Consequences

**Positive.** The board shows what the business earned after its running costs, from the same books the statements read, as soon as an expense is saved.

**Negative.**
- Until salary is posted by the payroll, it appears only when entered by hand as a «Зарлага».
- Under a branch the net profit excludes the «Нийтлэг» expenses; the branches' net profits do not sum to the company's.
- `TODO-VERIFY` with the owner: 520102 «Худалдан авалтын буцаалт» stands on the sales row I1 and so never counts; 910201 is an EXPENSE account on the gain/loss row and counts nowhere.

## Related

ADR-0105, ADR-0108, ADR-0148, ADR-0150, ADR-0184, ADR-0193, ADR-0236, ADR-0237, `docs/modules/reporting.md`, the guide's article `reports/10-profit-board.md`.
