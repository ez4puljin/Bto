# ADR-0239: The chart's groups kept by hand on «Дансны төлөвлөгөө»

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-23 |
| Deciders | Owner («Урсгал зардлын нэгдсэн дансны бүртгэл хэрэгтэй. Мэдээж тог цахилгаан гэх мэт, тус бүртээ данстай байх хэрэгтэй. Тэгэхээр дансны бүртгэл дээр дэд бүлгүүд байх хэрэгтэй гэсэн үг.», 2026-11-23), Claude (the brain and its worker) |
| Extends | ADR-0148 (Erkhet's chart with its group tree) |

## Context

The chart's tree (`fin.account_groups`: code, name, parent, sort, status) came from Erkhet in one call, `POST /gl-accounts/chart` (ADR-0148). No route or screen made, renamed or moved one group, and the account dialog had no group, so a new account landed outside the tree. Since ADR-0238 the profit board shows the operating expenses by this tree (group → sub-groups → accounts), and the owner wants each running cost (electricity, heating, water, rent …) in a sub-group of its own.

## Decision

1. **One group at a time, inside the core** (`FinChartService.createGroupInTx`, `updateGroupInTx`, `deleteGroupInTx`; scoped by company, an audit row `account_group` each: CREATE, UPDATE, DEACTIVATE). Routes `POST /gl-accounts/groups`, `PUT /gl-accounts/groups/:id`, `DELETE /gl-accounts/groups/:id`, all `finance.settings.manage` like the whole-tree upsert (in the core: `finance.settings.manage` or `finance.config.manage`). Group changes of a company queue behind one advisory lock (72_026_134), the whole-tree upsert too.
2. **Create:** a code of the core's shape, unique in the company (refused `FIN_PAYLOAD_INVALID`, field `group.code` `taken`), a name, an active parent or none (a root); it goes after its siblings. The code of a deleted group brings that row back with the new name and place.
3. **The code is fixed once made.** The whole-tree upsert finds groups by code: a renamed code would make the next upsert add the old code again beside it and move its accounts there. Nothing else keys on a group's code (`statement_row_links` holds accounts; the board and the reports join by id; the ledger report's group filter is chosen at run time). Only the name changes.
4. **Move:** under another active group of the company or to the top, after the new siblings; never under itself or one of its descendants (`group.parentId` `cycle`).
5. **Delete** = made inactive (groups are never removed, like accounts), only while no account (active or not) and no active group sits right under it (`group` `notEmpty`). An inactive group takes no account and no child (`groupId` / `parentId` `exists`) and is no longer offered; the page shows it only while it still holds a row being shown.
6. **An account carries its group** from its dialog: `groupId` on `POST /gl-accounts` and `PUT /gl-accounts/:id` (`finance.journal.manage`, as before), optional in the API (null: none), asked for by the dialog whenever the chart has a group, for a new account or one already in a group (changed there, never cleared); an existing account without a group may be saved with the field left empty. A new account's dialog chooses the active group whose code is the longest beginning of the typed code until the user picks one. A group change moves the account in the tree and nothing else: no balance, journal line or posting rule changes.
7. **Hand-made groups survive the whole-tree upsert.** `POST /gl-accounts/chart` still makes or changes the groups it carries by code (ADR-0148, unchanged) and leaves every other group as it is; an account it carries goes to the group its row names.
8. **The page** keeps ADR-0148's tree and adds «Бүлэг нэмэх» in the header and a «⋯» menu on each group row («Дэд бүлэг нэмэх», «Засах», «Зөөх», «Устгах»); the accounts with no group stand last under «Бүлэггүй данс». A refusal shows its own sentence. A guide article, «Санхүү → Дансны бүлэг, дэд бүлэг», tells the accountant how.

## Consequences

**Positive.** The accountant files each running cost under its own sub-group, and the profit board shows it there with no change to reporting.

**Negative.** The ACCOUNTANT role does not hold `finance.settings.manage` by default, so an admin keeps the tree (or grants the right to the accountant's role); the accountant still files accounts into it. An account the whole-tree upsert carries goes back to the group its row names, so a later Erkhet re-import undoes a hand move of such an account.

## Related

ADR-0069, ADR-0076, ADR-0102, ADR-0148, ADR-0149, ADR-0152, ADR-0238, docs/modules/finance.md, docs/modules/finance-core.md.
