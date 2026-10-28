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

### Open questions (TODO-VERIFY, owner unless noted)

- Who creates the draft receipt today, and from what (an Erkhet order, Butenorgil's purchase orders, Excel)?
- When arrivals differ from the draft (short, extra, a product not on the note), what does the keeper do?
- Does the accountant confirm **every** receipt's prices, even when the draft already holds them?
- Damage sold to the person at fault: is that person staff, the driver or the supplier? At which price (cost or sale price)?
- The truck driver's fee: who pays it, and does it go into the goods' cost?
- During the trial, are receipts entered in both Erkhet and Bto?

## 2. Goods issue («Зарлага»)

To be recorded.
