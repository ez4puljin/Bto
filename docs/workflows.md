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

### Open questions (TODO-VERIFY)

- Is the barcode scan today done in Butenorgil's receiving screen? (owner)
- Does the driver's fee go into the goods' cost? (accountant)
- Where is stock taken out today (wholesale sales, issues, the supermarket till), and in which system? (owner)

## 2. Goods issue («Зарлага»)

To be recorded.
