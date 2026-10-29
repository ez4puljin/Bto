# Module `procurement` — contract

Status: **built** as slice 1 of the approved order of work (`docs/workflows.md` §3–§4) in the session of 2026-10-29: ADR-0115, migration `0052_procurement`, branch `claude/slice1-po-receipts`. It brings delivery 8 forward in part:
- **Built:** purchase orders by supplier, receiving against the order, and the price check.
- **Not built yet:** reorder suggestions, supplier price history, trucks and kg fill (the next slice).

The work is walked by the owner on the development environment only; no real business transaction enters Bto during the trial.

**Code.**
- API: `apps/api/src/modules/procurement/`; the statuses and limits in `packages/shared/src/procurement`.
- Web: `apps/web/src/features/procurement/`. The keeper's receiving screen and the price check belong to inventory (`apps/web/src/features/inventory/receipt-receive-page.tsx`, `receipt-form.tsx`).

**Dependencies.** procurement depends on `identity`, `partners`, `catalog` and `inventory`, each through its `index.ts` (MODULE_DEPS). Nothing imports procurement: inventory declares the `RECEIPT_PROGRESS` hook and procurement binds it.

## 1. Owner's answers behind the design

The scope is in `docs/workflows.md` §4. Below are the answers of 2026-10-29, given in four rounds. Each choice was the proposal unless noted.

**Ordering**
1. **Grouping.** Orders are grouped by **supplier**; brands are not used.
2. **Suppliers per order.** One order holds **several suppliers**, each with its own status. The order shows the lowest.
3. **Orderer.** Each supplier has **one orderer**, set by a manager; one person may order for many suppliers.
4. **Products in the grid.** The supplier's **main** products.
5. **"Recent sales" column.** It counts **every outflow from the warehouse**: wholesale sales plus transfers to supermarkets, less returns. The period is **last month** only (the owner's choice among four).

**Statuses and editing**
6. **Partial arrival.** **Closes**: what did not arrive drops out and goes on a later order. There are no backorders.
7. **Status order.** The orderer or a manager moves Бэлдэж → Илгээсэн → Замд → Ирсэн. «Ирсэн» makes the draft receipt. The keepers' confirmation sets «Нягтлан шалгаж» and the accountant's price confirmation «Орлого авсан».
8. **Changing quantities after sending.** Possible **until «Ирсэн»** for the orderer and managers; keepers only in «Бэлдэж».

**Receiving and checks**
9. **Note totals.** The delivery note's **pieces** are checked at the keeper's confirmation and its **amount** at the accountant's. **Every receipt** carries them, including the window and the import.
10. **Goods not on the order.** The keeper **adds the line**, marked «Захиалгад байхгүй».
11. **A supplier's goods in two warehouses.** **Each warehouse's keeper confirms their own lines.** It stays one receipt, one number and one payable, and the stock comes in at the **last** confirmation.
12. **Arrived quantity.** It **starts empty**: every line is checked or marked «ирээгүй» before the confirmation.

**Menu**
13. **Placement.** A «Татан авалт» group inside «Агуулах».

## 2. Owned tables (migration `0052_procurement`)

| Table | What | Guards |
|---|---|---|
| `purchase_orders` | One order, numbered at creation `PO-YYYY-NNNNNN` (`NumberingService`, scope `PO`, Ulaanbaatar year). Holds `order_date`, `note` and `status`, the lowest supplier status, refreshed in every transaction that moves a supplier. | Number unique; status CHECK; note ≤ 500; `REVOKE DELETE, TRUNCATE` |
| `purchase_order_suppliers` | A supplier inside an order: `status`, `receipt_id` (the draft or posted goods receipt from «Ирсэн» on) and `status_changed_at/by`. | (order, supplier) unique; `receipt_id` unique; CHECK `receipt_id IS NOT NULL ⇔ status ∈ {ARRIVED, ACCOUNTING, RECEIVED}`; deleted only by `removeSupplier` in «Бэлдэж» |
| `purchase_order_lines` | An ordered product: `product_unit_id`, `qty`, `factor_snapshot`, `qty_base`, `updated_by/at`. | (order supplier, product) unique; qty > 0 (a zero deletes the row) |
| `supplier_orderers` | The orderer of a supplier, by user. | Primary key on the supplier; index on the user |

Inventory's side of the same migration is listed in `docs/modules/inventory.md`:
- the receipt lines' `expected_qty` and `checked_at`;
- the receipts' note totals, photo and origin;
- `goods_receipt_confirmations`.

## 3. Public API (`modules/procurement/index.ts`)

| Export | Use |
|---|---|
| `ProcurementModule` | The services below. Binds inventory's `RECEIPT_PROGRESS` to `OrderProgressService`, so a supplier follows its receipt in the receipt's transaction. |
| `ProcurementHttpModule` | The controllers (api only). |

Services (not exported beyond the module):

**`PurchaseOrdersService`**
- `create`, `update` (the note), `addSuppliers`, `removeSupplier`;
- `move` (one step forward or back);
- `get`, `list`;
- `refreshStatus(tx, orderId)`.

**`PurchaseOrderGridService`**
- `rows`: a supplier's grid, a keyset page of 200 over its main products by name;
- `saveLines`: the changed cells, against the values they had when the page opened;
- `sheets`: the print.

**`SupplierOrderersService`**
- `get`, `candidates` (active holders of `procurement.orders.edit`), `set`.

**`OrderProgressService`**
- ARRIVED → ACCOUNTING on `receiptPostedInTx`; ACCOUNTING → RECEIVED on `receiptCostedInTx`.

## 4. REST surface (`/api/v1`)

| Route | Right | What |
|---|---|---|
| `GET /purchase-orders?status&supplierId&mine&q&cursor&limit` | `procurement.orders.read` | Orders, newest first; `mine` keeps those with a supplier the caller orders from |
| `POST /purchase-orders` (`Idempotency-Key`) | `procurement.orders.manage` | `{orderDate?, note?, supplierIds}` |
| `GET /purchase-orders/:id` | read | Header and suppliers with status, orderer, line count, Σ pieces and kg, the estimated cost (price readers), the receipt, and what the caller may do (`canEdit`, `canMoveNext`, `canMoveBack`) |
| `PATCH /purchase-orders/:id` | manage | The note |
| `POST /purchase-orders/:id/suppliers` / `DELETE …/suppliers/:supplierId` | manage | Add suppliers / remove one in «Бэлдэж» |
| `POST /purchase-orders/:id/suppliers/:supplierId/status` (`Idempotency-Key`) | read + the rule of §5 | `{to}`: one step forward or back |
| `GET /purchase-orders/:id/suppliers/:supplierId/rows?q&filter=ALL\|ORDERED\|BELOW_MIN&cursor&limit` | read | The grid page with `outflowFrom` / `outflowTo` and `total` |
| `PUT /purchase-orders/:id/suppliers/:supplierId/lines` | `procurement.orders.edit` | `{changes:[{productId, productUnitId, qty, previousUnitId, previousQty}]}` → `{applied, conflicts, refused}` |
| `GET /purchase-orders/:id/print?supplierId` | read | The order sheets |
| `GET /procurement/orderer-candidates`, `GET/PUT /procurement/supplier-orderers/:supplierId` | read / manage | The orderers |

## 5. Rules worth knowing

**Who edits a cell.** This is `editRight`, checked per cell under `FOR UPDATE` on the order and its supplier rows:

| Who | Rows | Statuses |
|---|---|---|
| Manager (`manage`) | Every row | Up to «Замд» |
| The supplier's orderer (with `edit`) | Every row | Up to «Замд» |
| Others with `edit` | Products whose home warehouse is in their write scope (null = every warehouse) | «Бэлдэж» only |

Other cases:
- A product without a home warehouse is refused (`NO_HOME`).
- A product the supplier is not the main supplier of, and that has no line yet, is refused (`NOT_SUPPLIER`).
- Past the editable statuses, the whole save is 409 `PO_NOT_EDITABLE`.

**Optimistic save.** Each change carries the unit and quantity the page opened with (null = no line). A cell whose stored value differs is skipped and returned in `conflicts` with its current value. This is Butenorgil's lesson: a stale page once zeroed 13 brands. Every applied change is audited (`purchase_order_suppliers`, before and after).

**Moves.**
- Forward: by a manager or the supplier's orderer; refused with nothing ordered (`PO_SUPPLIER_EMPTY`).
- Back: by a manager only, up to «Ирсэн» (`PO_STATUS_INVALID` beyond).
- **«Ирсэн»** makes the draft receipt: origin ORDER, `origin_ref` = the order's number, the business date as the note's date.
  - Each line expects the ordered quantity in its unit, arrived 0, unchecked.
  - Its `doc_unit_price` is the product's last delivery-note price per base unit × the unit's factor.
  - A homeless product refuses the move (`PRODUCT_NO_HOME`).
- **Back from «Ирсэн»** cancels the draft (`ReceiptsService.cancelOrderDraftInTx`). It is refused once a keeper confirmed a warehouse (`RECEIPT_WAREHOUSE_CONFIRMED`).
- **Lock order.** The receipt is locked before the order, as the receipt's own hook does (receipt → order), so the two never wait on each other.

**Progress from the receipt.**
- The keepers' last confirmation posts the receipt; procurement sets ARRIVED → ACCOUNTING.
- The accountant's first price check (costing version 1) sets ACCOUNTING → RECEIVED.

**The grid.**
- **Products:** the supplier's main products, plus any already ordered, that are ACTIVE, by name, searched like the product list (`ProductQueryService.orderedIds`, at most 5,000).
- **On hand and minimum:** the home warehouse's `warehouse_stock.on_hand` and `product_locations.min_qty`.
- **Outflow:** last calendar month's (`StockQueryService.outflowOf` → `StockPostingService.outflow`).
- **Last price:** `ReceiptsService.lastPrices`, for price readers only (the key is absent for others).
- **Estimated cost:** Σ ordered `qty_base` × last price per base unit.

## 6. Error codes introduced

| Code | Status | When |
|---|---|---|
| `PO_NOT_EDITABLE` | 409 | The supplier is past the statuses the caller may type in |
| `PO_SUPPLIER_EMPTY` | 409 | Moving on a supplier with nothing ordered |
| `PO_STATUS_INVALID` | 409 | Not the next or previous status; removing a supplier past «Бэлдэж» |

The receipt codes of the slice are in `docs/modules/inventory.md` §6.

## 7. Audit

| What | Audited as |
|---|---|
| Order creation | `CREATE purchase_orders` |
| Note change; suppliers added or removed | `UPDATE purchase_orders` |
| Every move, including the hook's | `UPDATE purchase_order_suppliers` |
| Every applied cell | `UPDATE purchase_order_suppliers` (product, before, after) |
| Orderer changes | `UPDATE supplier_orderers` |

## 8. Screens (`apps/web`)

All in «Агуулах → Татан авалт»:
- **«Худалдан авах захиалга»** (`/procurement/orders`): the list, and a new order on `?new=1` (date, note, the ticked suppliers).
- **The order** (`/procurement/orders/:id`, full width):
  - the supplier strip, with each status, orderer, lines, estimated cost and the next / back buttons («Ирсэн» asks first);
  - the grid of the chosen supplier (`?supplier=`): unit and quantity per row, «Хадгалах (n)», and the conflicts shown;
  - the print link.
- **The order sheets** (`/procurement/orders/:id/print?supplierId=`, browser print, ADR-0058).
- **«Захиалагч» card** on the supplier page.

The receiving screen and the price check are inventory's (`docs/modules/inventory.md` §9).

## 9. Tests

- **Integration:** `procurement.int-spec.ts`:
  - numbering and every role rule;
  - the grid figures, with keepers seeing no price;
  - the stale-page conflict and refused rows;
  - moves, «Ирсэн» → a draft expecting the ordered quantities at the last prices;
  - the ORDER draft not cancellable from the window;
  - each keeper confirming their warehouse, frozen lines, the pieces mismatch, the posting onto NOSHELF (sellable at once);
  - no bill until the price check, the 1₮ amount check, RECEIVED and the bill;
  - stepping back from «Ирсэн» cancelling an untouched draft, refused once posted.
- **Integrity:** `procurement-races.spec.ts`: two saves of one empty cell → one applied, one conflict; two keepers confirming at once → posted once with its ledger rows, the order at ACCOUNTING.
- **Shared (Vitest):** `procurement.test.ts` (lowest status, the moves, the 1₮ check).
- **Web:** `features/procurement/orders-pages.test.tsx`.

## 10. Open items

- **Trucks and kg fill:** the next slice.
- **Reorder suggestions and supplier price history:** delivery 8's remainder.
- **The assistant's views:** `ai.purchase_orders` / `ai.purchase_order_lines`.
- **The staff app's receiving.**
- **The driver's fee in the goods' cost:** for the accountant (TODO-VERIFY, `docs/workflows.md` §1).
