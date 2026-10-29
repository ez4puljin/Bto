# Real workflows (as-is)

How Бүтэн-Оргил ХХК works today, in the owner's words, compared with Bto. This is the input for the first live slice: warehouse receipts and issues (owner, 2026-10-28). Facts only. No names, prices or other business data, because the repo is public.

## 1. Goods receipt («Орлого»)

Recorded with the owner on 2026-10-28.

### As-is

1. **Ordering and transport.** Goods are bought in Ulaanbaatar. The company hires a truck driver and parks the truck at the market. Each supplier gets the truck's location and the company's order. The supplier prepares the goods, brings them to the truck and hands them over with the delivery note («падаан»). The order was placed in advance, so a **draft receipt already exists** before the goods arrive.
2. **Receiving.** The warehouse keeper («нярав») receives the goods by checking them against the draft in the system. The keeper only records what arrived and **confirms the quantities**.
3. **Prices.** After the keeper confirms the quantities, the **accountant confirms the prices**. The draft then becomes a full receipt and the supplier's **payable** («өглөг») is created.
4. **Tool today.** Receipts are entered **only in Erkhet**.
5. **Damage.** The keeper confirms the quantities. When goods arrive damaged and the company is at fault, the supplier is paid for the full quantity. The loss is then **sold to the person at fault**, which creates a receivable on that person.
6. **Storage.** Each product is put away in its own warehouse. **Shelf (bin) locations are not used** today.

### In Bto today

| Step                                                     | Bto                                                                                                                                                                                                                                                                              | Fit             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Draft exists before arrival, from the order              | A draft receipt is created by hand or by the RECEIPTS import (ADR-0078 #7). There are no purchase orders (procurement is delivery 8).                                                                                                                                             | partial         |
| Keeper confirms quantities against the draft             | The keeper edits the draft lines and posts. Stock comes in at posting. The draft shows one quantity per line, with no "ordered vs arrived" column.                                                                                                                                | partial         |
| Accountant confirms prices → payable                     | A receipt posted without prices waits for costing (`costing_status` PENDING). Costing makes the bill (ADR-0091). A receipt posted **with** prices becomes the bill at once, with no accountant step.                                                                              | differs         |
| Payable on the supplier                                  | Automatic: Dr 140101, Dr 130301 / Cr 310101 (temporary codes, D16).                                                                                                                                                                                                             | fits            |
| Damage sold to the person at fault                       | No dedicated flow. A sales invoice to that person as a customer creates a receivable. A goods issue to a USER recipient creates none (ADR-0081).                                                                                                                                 | missing         |
| Each product in its warehouse, no shelves                | A line goes to its product's home warehouse (ADR-0099). Bto still puts it on the product's fixed shelf, else RECEIVING, and RECEIVING is **not sellable** (`isSellableBinType`). A product with no fixed shelf cannot be sold until someone moves it.                                                                                     | differs         |
| Erkhet is the only tool                                  | Bto would replace Erkhet's receipts. Finance still runs on Erkhet until go-live, so the trial needs an answer on double entry.                                                                                                                                                  | open            |

### Answers (owner, 2026-10-28, round 2)

1. **Where the draft comes from.** Butenorgil's «Захиалга» menu, the purchase orders. Butenorgil (ez4puljin/Butenorgil) also has receiving sessions with confirmation per brand, a price-review flag per line, trucks per order, and an export to Erkhet's Excel and import queue (`backend/app/api/purchase_orders.py`, `receivings.py`, `erkhet_import`). Today the ordering and receiving work therefore runs in Butenorgil, and Erkhet holds the result.
2. **Differences on arrival.** Scanning a product's barcode shows the quantity expected for it. The keeper corrects it when it differs, or marks the product as «ирээгүй» (did not arrive).
3. **Price check.** The draft shows the price of the product's previous receipt. The accountant compares each product's new delivery-note price with the draft's, confirms it, and changes it when it differs. Every receipt goes through this step.
4. **Damage.** The person at fault is a staff member, the driver or someone else. They pay the price in the program (the sale price).
5. **Truck driver's fee.** The company pays it. Whether it goes into the goods' cost is still open (accountant).
6. **Trial.** From the trial on, receipts are taken **only in Bto**. Nothing is entered in Erkhet.

### What the answers change

- **Scan against expected quantities.** The receipt draft needs an expected quantity per line next to the arrived quantity, a barcode scan that jumps to the line, and «ирээгүй». Today Bto has one quantity per line.
- **The accountant's price step on every receipt.** The keeper's posting must leave the prices waiting for the accountant, even when the draft holds prices. The accountant then sees each line's previous price next to the new one, confirms it or changes it, and only that makes the payable. Today a priced draft becomes the bill at the keeper's posting (ADR-0091).
- **Shelves.** With no shelves in use, received stock must be sellable at once. One default shelf per warehouse would do this, for example the existing «Тавиургүй» `NOSHELF`.
- **Damage charged to a person.** This belongs to the issue side: a charge to a staff member, driver or other person at the sale price, creating a receivable.
- **Receipts only in Bto: the consequence.** Stock and payables then live in Bto alone. Sales and other stock movements still recorded in erxes or Erkhet would no longer meet these receipts, so neither system's stock would be right. The supplier payables and their payments would also have to be in Bto. Before the trial, the next round must settle where stock leaves today (sales, issues, the supermarket) and how that reaches Bto.

### Answers (owner, 2026-10-28, round 3)

1. **The scan is not in Butenorgil.** Butenorgil holds the orders. The keeper's scan against the expected quantities and the accountant's price check happen on the draft receipt in Erkhet.
2. **Where things are recorded.** erxes is used **only for sales**. It syncs to Erkhet. Every receipt, issue, cash and bank transaction, and the stock balances are kept **only in Erkhet**.
3. **Decided by the owner:** the **big path**. Ordering and receiving are built in Bto itself, with Butenorgil's «Захиалга» menu as the reference. The alternative was feeding Butenorgil's orders into Bto as draft receipts.
4. **Decided by the owner:** the trial runs **only in Bto's development environment**, with test receipts. No real business transaction is entered in Bto as well. The double-books problem above therefore does not arise during the trial.

### The first slice, as now understood

Purchase order (Butenorgil's «Захиалга» as the reference) → draft receipt → the keeper scans against the expected quantities, corrects them or marks «ирээгүй» → the accountant confirms each line's price against the previous one → the payable. Received stock is sellable without shelves. Procurement was planned for delivery 8, so this brings it forward.

### Open questions (TODO-VERIFY)

- Does the driver's fee go into the goods' cost? (accountant)
- The ordering details in Butenorgil's «Захиалга» (statuses, brands, trucks, who does what): read from its code, then confirmed with the owner.

## 2. Stock out: issues, sales, transfers, counts

Recorded with the owner on 2026-10-29. "Today" means Erkhet, erxes and paper. "To be" means what the owner wants Bto to do.

### Answers

**Kinds of issue**
- **1.1** Every kind exists: wholesale sales, transfers to a supermarket, transfers between the Mörön warehouses, write-offs of damaged or expired goods, internal use, gifts and samples, returns to suppliers, and damage sold to the person at fault.
- **1.2** Sales and transfers are by far the most frequent.
- **1.3** An issue names an **account** (for example a meals expense account) **and a party** (for example the cook). The account report can then be filtered by account (all meals), by account and party (one driver's meals), or by the receivables account and party (the receivable sales charged to that cook). Account and party are always chosen together.

**Wholesale sales leaving the warehouse**
- **2.1** Sales reps take orders in the rep app, and customers send orders from the Bto300 app.
- **2.2** A warehouse assistant picks and the warehouse keeper confirms the pick. This is on paper today. **To be:** picking in a Bto app by choosing the order (to be built).
- **2.3** When stock is short, the order is reduced.
- **2.4** The keeper hands the goods over after checking that the pick matches the order. An order often holds goods from several warehouses. When **every warehouse's keeper has confirmed**, the **senior warehouse keeper** («Агуулахын ахлах») prints the sales document.
- **2.5** erxes syncs the sale to Erkhet automatically and at once. Sales left behind by a network or server problem are synced by hand.
- **2.6** **Customer returns.** The receivables accountant notes the return and checks it on the camera, then makes the return against that customer's sale.

**Supermarkets and transfers**
- **3.1** Supermarket goods come from both the Mörön warehouses and directly from suppliers.
- **3.2** The supermarket's seller sends the request through the sales rep app.
- **3.3** **To be:** the supermarket receives in the app by scanning barcodes. Differences and goods with another barcode are recorded in the app, then confirmed finally. The warehouse keeper confirms as well.
- **3.4** There are **5 warehouses and 2 supermarkets**.
- **3.5** Kharkhorin runs its own Bto, so goods for Kharkhorin are sold to Kharkhorin as a customer.

**Damage and write-offs**
- **4** Skipped by the owner for now.

**Approval and responsibility**
- **5.1** The **accountant creates** an issue and the **warehouse keeper confirms** it finally.
- **5.2** A keeper issues only from their own warehouse.
- **5.3** A correction is sent as a change. When the keeper confirms it, the change takes effect at once.

**Counts**
- **6.1** A count runs every month. Usually it covers a whole warehouse. Sometimes it covers one supplier's goods, and any product segment can be counted.
- **6.2** Counters use a counting app and scan barcodes to enter the quantities.
- **6.3** Sales stop during a count.
- **6.4** The count's final surplus and shortage become a **receivable on a party**.

**Pain points**
- **7.1** Receiving and transfers produce the most errors.
- **7.2** Nothing must be kept unchanged.

### In Bto today

| Need | Bto | Fit |
| --- | --- | --- |
| Issue with account and party | A goods issue has an expense type (its account) and a recipient: user, customer, supplier or other (ADR-0081). Whether the expense line carries the recipient as the party for the account report is still to check. | partial |
| Accountant creates, keeper confirms | One step: whoever holds `inventory.issues.manage` posts. | missing |
| Correction confirmed by the keeper | A posted document is immutable, and a correction is a reversing document (architecture §12). A confirmed change can post the reversal and the new document for the user in one step. | differs |
| Orders from the rep app and Bto300 | Built (ADR-0061, ADR-0079). | fits |
| Assistant picks in an app, keeper confirms per warehouse, senior prints when all have confirmed | Picking is a stage on the web board with counts into STAGING (ADR-0056), with reservations per home warehouse (ADR-0055). There is no picking app, no confirmation per warehouse and no senior's step. | partial |
| Short stock reduces the order | Backorders and pick by counts (ADR-0055 / ADR-0056). The exact behaviour is still to check. | partial |
| Return against the customer's sale | A credit note against an invoice puts the goods into RETURNS (ADR-0060). | fits |
| Supermarket request from the app, receive by scan with differences, keeper confirms | Transfers exist on the web: REQUEST / PUSH, then SHIPPED and RECEIVED (ADR-0035). They are not in the app, have no scan receiving and no differences step. | partial |
| 5 warehouses and **2 supermarkets** | Bto's documents assume **one** supermarket branch (CLAUDE.md). A second store means a second till edge and its own e-Barimt branch. | differs |
| Kharkhorin as a customer | Fits ADR-0084. | fits |
| Monthly count by warehouse, supplier or segment, in an app | Stocktakes are by bin, blind, with a scan route (ADR-0038). There is no scope by supplier or segment and no counting in the app. | partial |
| Count result as a receivable on a party | The difference goes to loss and gain accounts through an adjustment. It is never charged to a person. | missing |

### Answers (owner, 2026-10-29, follow-up)

- **The second supermarket** has its own sub-POS and till, but **no e-Barimt branch code of its own**. How its receipts are issued is still to settle (TODO-VERIFY).
- **Counts** get an interview of their own, later.
- **The order of work below is approved.**

## 3. The order of work (approved by the owner, 2026-10-29)

Work runs one slice at a time. Each slice is finished, and the owner walks it on the development environment, before the next one starts. The slices that cause the most errors today come first.

1. **Purchase order → receipt.** The receipt is scanned against the expected quantities, with «ирээгүй» for goods that did not arrive. The accountant confirms the prices on every receipt. The confirmation creates the payable. Received stock is sellable without shelves. Butenorgil's «Захиалга» is the reference.
2. **Transfers.** The supermarket requests from the app. The goods are received by scan, with the differences recorded. The keeper confirms.
3. **Issues.** The accountant creates and the keeper confirms. The account and the party are chosen together. A correction takes effect once the keeper confirms it.
4. **The picking app.** The assistant picks. The keeper of each warehouse confirms. The senior keeper prints once all have confirmed.
5. **Counts.** These come after their own interview.

Still open: write-offs and damage (question 4), and how the second supermarket issues e-Barimt receipts.

## 4. Slice 1 scope: purchase order → receipt (owner, 2026-10-29)

The reference is Butenorgil's «Захиалга» (a read-only study). Recorded scope:

**In**
1. **Purchase orders.**
   - The user picks suppliers (or brands) and types quantities per product in any of the product's units, for example boxes.
   - Beside each line, from Bto's own data: stock, the minimum, recent sales, the last receipt price and the estimated cost.
   - A printable order sheet per supplier.
   - Saving sends only changed cells, so a stale page never overwrites a colleague's edits.
2. **Who types quantities.** The brand's orderer (the staff member who orders that supplier), managers and senior staff (all suppliers), and warehouse keepers (only their own warehouse's products, while the supplier is in «Бэлдэж»).
3. **Six statuses per supplier inside an order**: Бэлдэж → Илгээсэн → Замд → Ирсэн → Нягтлан шалгаж → Орлого авсан. The order shows the lowest of them.
4. **On arrival, one draft receipt per supplier**, with the expected quantities and the last prices filled in.
5. **Receiving.**
   - A barcode scan jumps to the line and shows the expected quantity.
   - The keeper corrects the quantity or marks «ирээгүй».
   - The supplier's delivery note totals (pieces and amount) are typed and must match within 1₮. A photo of the note is optional.
   - The keeper's confirmation brings the stock in, sellable at once without shelves.
6. **The accountant's price check on every receipt.**
   - The previous and the new price sit side by side, with differences highlighted.
   - The accountant's confirmation creates the payable.
   - Receipts without an order (the existing receipt window) go through the same check.

**Out (later)**
- Trucks and kg fill: the next slice.
- The Erkhet export, the erxes price plans, the Kharkhorin company and Butenorgil's legacy supervisor screen: not needed.


### Answers (owner, 2026-10-29, slice 1 rounds)

Four short rounds before the build. Each choice below was the proposal, unless a different choice is noted.

**Ordering**
1. **Grouping.** Orders are grouped by **supplier**. Brands are not used.
2. **Suppliers per order.** One order holds **several suppliers**, and each supplier has its own status. The order shows the lowest of them.
3. **Orderer.** Each supplier has **one orderer**, a staff member set by a manager. One person may order from many suppliers.
4. **Products in the grid.** The grid lists the supplier's **main** products.
5. **The "recent sales" column.** It counts **every outflow from the warehouse**: wholesale sales plus transfers to supermarkets, less returns. The owner chose to show **last month** only.

**Statuses and editing**
6. **Partial arrival.** It **closes the line**: what did not arrive drops out of the order and goes on a later one. There are no backorders.
7. **Who moves the statuses.** The orderer or a manager moves Бэлдэж → Илгээсэн → Замд → Ирсэн. «Ирсэн» makes the draft receipt. The keepers' confirmation sets «Нягтлан шалгаж», and the accountant's price confirmation sets «Орлого авсан».
8. **Changing quantities after sending.** Possible **until «Ирсэн»** for the orderer and managers. Keepers may change them only in «Бэлдэж».

**Receiving and checks**
9. **The delivery note's totals.** The **pieces** are checked at the keeper's confirmation, and the **amount** at the accountant's, within 1₮. **Every receipt** carries both totals, including the receipt window and the Excel import.
10. **Goods not on the order.** The keeper **adds a line** for them, marked «Захиалгад байхгүй».
11. **A supplier's goods in two warehouses.** **Each warehouse's keeper confirms their own lines.** It stays one receipt, with one number and one payable. The stock comes in at the **last** confirmation.
12. **The arrived quantity starts empty.** Every line is checked, or marked «ирээгүй», before the confirmation.

**Menu**
13. **Where the orders sit.** In a «Татан авалт» group inside «Агуулах».

**Built 2026-10-29** as ADR-0115 with migration `0052_procurement` (`docs/modules/procurement.md`). The owner walks it on the development environment:
- an order with two suppliers;
- the orderer's and a keeper's quantities;
- the printed sheet;
- «Ирсэн»;
- the receiving screen with a scanner;
- each keeper's confirmation;
- the accountant's price check;
- the payable.

The trucks and the kg fill come in the next slice.

## 5. Slice 2 scope: transfers (owner, 2026-10-29)

One question round before the build. Each item below was the proposal, and the owner accepted every one ("Бүх саналууд зөв"); the two store names are the owner's.

**Requests (the store's seller, in the staff app)**
1. **Where.** A «Шилжүүлэг» section in the staff app («Bto Бараа дэлгэц»), shown only to users whose write scope is a STORE warehouse and who hold `inventory.transfers.manage`. The seller signs in with the same staff login.
2. **Several source warehouses in one request.** One request lists products; the lines are grouped by the product's home warehouse, like a purchase order's suppliers, and each warehouse's keeper ships their own group. Today's one-source transfer document becomes one group of such a request.
3. **Beside each line:** the store's stock, the home warehouse's stock, last month's sales at the store, and the unit (box or piece).
4. The web's «Бага үлдэгдэл → Шилжүүлэг хүсэх» stays as it is.

**Shipping (the warehouse keeper, on the web)**
5. The keeper prepares the group on the web, as in slice 1 (a wedge scanner on the web screen); the app is the seller's.
6. The shipped quantity may differ from the requested one (less when stock is short). The shipped quantity becomes the receiving screen's expected quantity.
7. A printed sheet travels with the goods. Trucks and drivers are not in this slice.

**Receiving (the store, in the app, by scan)**
8. As in slice 1: a scan jumps to the line and shows the **shipped quantity**; the seller types the arrived quantity, or marks «ирээгүй». No blind count.
9. "Goods with another barcode" covers both cases: a known product under another of its barcodes resolves to its line; a product that is not on the request is added as a new line (marked «Хүсэлтэд байхгүй») and is taken from the sender's stock as a surplus.
10. **Differences keep ADR-0035's rule:** a shortfall goes back to the sending warehouse's stock, a surplus is taken from it. No receivable on a person.

**Confirmation**
11. The seller finishes the receipt in the app → each sending warehouse's keeper sees the differences of their group and confirms on the web → the stock moves (the ledger legs of ADR-0035). The keeper may send a group back to the seller instead of confirming.
12. The keeper confirms on the web.

**Scope**
13. Transfers between the Mörön warehouses use the same documents on the web (a request by the receiving keeper, shipping and confirmation as above); they are not in the app in this slice.
14. Returns from a store to a warehouse (PUSH) keep today's web flow; not in the app in this slice.
15. **Two stores.** The main supermarket's warehouse `S1` is renamed **«Заал»** and a second STORE warehouse **`S2` «Заалны архи»** is added (done on the development database 2026-10-29; its till, edge and e-Barimt come later, TODO-VERIFY in §2).

Reserved for the build: ADR-0116 and migration `0053` (branch `claude/slice2-transfers`).

**Built 2026-10-29** as ADR-0116 with migration `0053_transfer_requests` (`docs/modules/inventory.md` §5 «Transfer requests», `docs/modules/mobile.md` §1b): a request header with one transfer per home warehouse; the staff app's «Шилжүүлэг» for a store's seller (the request with the store's stock, the home stock and last month's sales beside each product; receiving by scan with «Ирээгүй» and products not asked for); the count saved on the server line by line; each keeper ships, then sees the count and confirms (or sends it back) on the web; the ledger moves at the confirmation. The owner walks it on the development environment:
- a request from the app as a store user (S1 «Заал» in the write scope) with products from two home warehouses;
- each keeper ships their group on the web, one of them short, and prints the sheet;
- the receipt in the app by scan: one shortfall, one «Ирээгүй», one product not on the request;
- each keeper's confirmation on the web;
- the movement history and the shelf stock afterwards.

## 6. Slice 3 scope: issues (owner, 2026-10-29)

One question round before the build, run beside slice 2 as the owner asked for two sessions at once. Each item below was the proposal, and the owner accepted every one ("Бүх саналууд зөв").

**Who does what**
1. The accountant creates the issue on the web and **sends** it; the keeper of each warehouse **confirms** their own lines; the goods leave at the confirmation. A keeper who cannot confirm sends it back with a note.
2. An issue with goods from several warehouses: each warehouse's part **posts on its own when its keeper confirms** (unlike slice 1's receipt, which waits for the last confirmation; issued goods leave separately).
3. Scanning at the confirmation is optional: the keeper ticks each line from the list, and a scan jumps to the line.

**Account and party**
4. The account comes from the Finance Core's chart of accounts (each of today's issue types is bound to one account); the party (staff member, customer, supplier or other) is **mandatory**. The account report filters by account, and by account and party.
5. **Damage charged to a person** is in this slice: an issue type «Хүнд тооцох» priced at the sale price, creating a receivable on the party (a staff member or a customer).
6. Returns to a supplier (reducing the payable) follow the same flow.

**Corrections**
7. A posted issue is corrected by the accountant sending a **change** (new quantities); when the keeper confirms it, the reversal and the new document are booked in one step.

**Scope**
8. Kharkhorin is a customer (sales), never an issue (ADR-0084).
9. Write-offs and damage (question 4 in §2) are not designed here; they are booked as ordinary issue types.

Built 2026-10-29 as ADR-0117 with migration `0054_issues_confirmed` (branch `claude/slice3-issues`). Slices 2 and 3 both touch `inventory`: whichever merges second merges main again and puts its journal entry last.

## 7. Slice 1b scope: the order's detail page as in Butenorgil (owner, 2026-10-29)

The owner wrote a user guide of Butenorgil's «Захиалга» menu (kept in `tmp/`, not in the repository) and compared it with slice 1. Already in Bto: suppliers with their own statuses and the lowest shown, the orderer, box ordering with stock / minimum / last price / estimated cost, the stale-page protection, the printed sheet, receiving against the order with «ирээгүй» and extra lines by scan, the accountant's price check with the previous price beside. Gone by design: the master, stock and sales file imports, the live Erkhet stock, the ERP import and its double-receipt guard (Bto keeps the books itself).

**The owner's main want: Butenorgil's detail page** — one page per order with every supplier's products in one table and every stage's columns side by side, from ordering to the price check, instead of today's three places (order grid, receiving screen, receipt window).

**Decided (every item was the proposal; 1–3 the owner's explicit yes):**
1. **«Ачигдаж байна» status and the «Ачигдсан» column** come back (7 statuses: Бэлдэж → Илгээсэн → Ачигдаж → Замд → Ирсэн → Нягтлан шалгаж → Орлого авсан). The manager or the orderer types the supplier's shipped quantities at «Ачигдаж»; receiving then expects the shipped quantity (the ordered one when none was typed).
2. **Keepers' typing rights stay**: their own warehouse's rows, the order quantity in «Бэлдэж» only, the arrived quantity in «Ирсэн» only.
3. **The list opens the detail page directly** (no dashboard).
4. **Header:** date, number, status, the status steps as circles (done / current / next), buttons Хадгалах · Хэвлэх · Түүх · Excel · one step back (manager). A yellow bar «Өөр хэрэглэгч энэ захиалгыг шинэчиллээ» with «Дахин ачаалах» when another user changed the order; the page never refreshes on its own while someone types.
5. **Filter row:** supplier, warehouse, code / name search, «Захиалах ёстой» (below the minimum), «Зөвхөн захиалсан», «Багана» (column groups hidden per user; the columns a stage requires cannot be hidden).
6. **Supplier header row:** name, status, «→ дараагийн шат», «N захиалаагүй», boxes · kg, the orderer, «Захиалгад байхгүй бараа нэмэх» at «Ирсэн».
7. **Columns by stage:**
   - ordering: stock at the home warehouse (boxes and pieces under it), box size, unit weight, **Захиалах** in boxes (pieces and kg computed), 12-month average, 3-month average, last month, the same month last year, the last price, the estimated amount;
   - shipping: **Ачигдсан**;
   - receiving: **Ирсэн as boxes × pieces**, the difference, a **note** shown only on a difference; typed by the keeper for their own warehouse, written to the receipt lines (the keeper's scanner screen stays and writes the same lines);
   - the price check: **unit price**, amount, the price difference with «Хуучин» under it, typed by the accountant at «Нягтлан шалгаж»; saving runs the price check and creates the payable;
   - a red «Захиалах» badge in the name cell below the minimum; the footer with boxes, kg, the estimated and the final amounts and «N бараа дээр үнэ зөрсөн».
8. **Also in:** the order's **history screen** (who, when, which product, from → to, filter by user / supplier / product, Excel), the order's **Excel**, **archiving** finished orders out of the list.
9. **Not in:** the dashboard, trucks and capacity (a slice of their own), the «Ороогүй бараа» basket dialog (the grid lists every main product), a supervisor role or forced status jumps, products of another supplier in a supplier's group, orders for the stores («Заал») from suppliers — the last two wait for the owner's word.

Reserved for the build: ADR-0118 and migration `0055` (branch `claude/slice1b-order-detail`); it starts when one of the two running slices has opened its PR.
