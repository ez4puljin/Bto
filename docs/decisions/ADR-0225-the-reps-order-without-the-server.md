# ADR-0225: The rep's order without the server

|           |                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                                                                                                                                                         |
| Date      | 2026-11-19                                                                                                                                                                                                                       |
| Deciders  | Owner (2026-11-19: «Server унтарсан ч Төлөөлөгч захиалга илгээгээд Server сэргэхэд бүгд ирдэг байхаар аппыг шинэчил … ямар ч дата алдагдахгүйгээр», then «Тийм, хий»), Claude (the brain's session)                              |
| Amends    | ADR-0020 (#1, for the sales rep's order only, building its #6), ADR-0061 (#5, the price the app shows)                                                                                                                           |

## Context

Since 2026-11-12 the centre runs on one PC in the store (ADR-0186, ADR-0187). When that PC, its network or the Cloudflare tunnel is down, the staff app answers nothing, and a sales rep standing in a shop cannot take the order: the shop, the customers and the checkout all read the server. ADR-0020 deferred every offline mode (#1) but shaped every document-creating request so that a later queue would need no change in the api (#2: a client-generated `Idempotency-Key` with the stored answer; #3: whole documents; #6: a staff-app queue that persists the same requests and replays them in order). The owner asked for exactly that queue for the rep's orders, with nothing lost.

Two facts shape what «nothing lost» can mean:

- The server forgets a key after seven days (`HousekeepingService` purges `idempotency_keys`). A request sent again with a key the server has forgotten is a new order.
- A server restored from an older backup has lost the orders written after that backup, and their keys with them; the phone was told those orders were saved.

What the phone needs to write an order alone was checked against the screens: the shop's products with their units, barcodes, wholesale prices, deal badges and home stock (the `SalesRepProduct` row the screens already draw), the customers with their addresses (a delivery needs an `addressId`) and contacts, the stages and warehouses (`GET /sales-rep/context`), the categories and the suppliers. On the development database that is 12,818 products and 1,404 customers.

## Decision

1. **Only the sales rep's order works without the server.** Collections, visits, picking, transfers, counts, attendance and the customer app «Bto300» stay online-only (ADR-0020 #1 stands for them). Money records (a rep's cash collection) are decided separately.
2. **The phone keeps what an order needs on its disk**, refreshed while online: the shop's products, the customers with their addresses and contacts, the context (stages, warehouses), the categories and the suppliers. Two walks serve the large lists, both `sales.orders.rep`, both on `/sales-rep/*` and so on the app replicas (ADR-0192):
   - `GET /sales-rep/offline/products?cursor&limit` (limit 1–500, default 500): every product `GET /sales-rep/products` shows the caller (the staff app's segments, ADR-0164, and the app's stock rule, ADR-0173 #1), by id, in the same `SalesRepProduct` row plus `mainSupplierId` (the supplier filter). No search, no filter, no count.
   - `GET /sales-rep/offline/customers?cursor&limit` (limit 1–1,000, default 1,000): every ACTIVE customer the caller may see (`visibleTo`), by id, with the list row's fields, the detail's live addresses (the default first) and contacts, the overdue receivable and the manual `creditHold`.
   Both are keyset by id (`{ data, nextCursor }`), without OFFSET or a count, and cost per row what the screens' own lists cost. `context`, `categories` and `suppliers` are small and unpaged; the phone keeps their usual answers. The staff app opens from a stored sign-in when the server does not answer.
3. **An order goes into an outbox on the phone before anything is sent**: any number of orders, each with its own `Idempotency-Key` and whole body (ADR-0020 #2, #3), sent oldest first by the app itself whenever the server answers. The cart no longer locks while an order waits.
4. **The price the phone shows without the server is an estimate («≈»)** from the last prices it downloaded. The order's price, stock reservation, credit check and delivery-date check are the server's, on the day the order arrives: ADR-0061 #5 («the app never computes a price») stays true for the order itself, which carries no price. A refused order stays in the outbox with the server's reason (its problem+json `code`) until the rep corrects or deletes it; nothing is dropped silently.
5. **The phone asks which keys the server knows.** It keeps the orders it sent for three days and asks `POST /sales-rep/orders/known` `{ keys }` (1–200 UUIDs; `sales.orders.rep`; not `@Idempotent`); the answer has one entry per key the server holds for the caller (the interceptor's own scoping, actor kind and id), `{ key, status: COMPLETED | IN_PROGRESS, createdAt, orderId }`, with `orderId` the order a completed `POST /sales-rep/orders` created. A key that is absent was lost (a restore from a backup, or a refusal, which releases the key) and that order is sent again with the same key and body. Three days stays well inside the seven the server keeps keys, so a resend never meets a forgotten key. A key long `IN_PROGRESS` (a request that died between the order's commit and the key's completion) cannot be sent again (the server answers 409 `IDEMPOTENCY_KEY_IN_PROGRESS`); its `createdAt` lets the phone tell a stale one.
6. **What is not covered, stated plainly:** a phone lost or broken, or the app uninstalled, before its outbox was sent loses those orders; an order that reached the server but whose answer was lost, and that waits in the outbox longer than the key's life (seven days), would arrive a second time.

## Alternatives considered

| Alternative                                                       | Why rejected                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A sync engine, offline-first for every screen                      | ADR-0020's reasons stand: months of work and a class of conflicts (stock, money, credit) that only the server can settle.                   |
| Sending the phone's price with the order                           | Prices, discounts and rates are frozen by the server at submit (ADR-0055, ADR-0061 #5); a price from an old download would bind the company. |
| Resending every sent order after any outage without asking        | A key older than the purge would create a duplicate; asking costs one indexed read per 200 keys.                                            |
| Reusing `GET /sales-rep/products` for the walk                     | Its first page counts, its order (NEW) moves as products become sale-ready, and its pages are 200 rows; a walk by id is steadier and cheaper. |

## Consequences

**Positive.** A rep keeps working through an outage of the centre, and the orders arrive by themselves when it is back, with the server's own checks; a restore from a backup no longer loses orders the phones still hold.

**Negative.** A full refresh of the shop is about 8 MiB of JSON (about 1 MiB as sent, compressed by Caddy) and about 6 s of server time in 26 pages, per phone, a few times a day; customers about 0.3 MiB in two pages. An order taken offline may be refused on arrival (price changed, stock gone, credit hold), and the rep learns it only then.

**Follow-ups.** The phone's side (outbox, stored sign-in, the «≈» price, the three-day check) is built in `apps/mobile` against these routes. A stale `IN_PROGRESS` key cannot yet say whether its order was created; a later change may record the key on the order in the handler's transaction so `known` can answer it.

## Related

ADR-0002, ADR-0004, ADR-0020, ADR-0027 (#11), ADR-0061, ADR-0164, ADR-0173, ADR-0192, `docs/modules/sales.md` §4, `apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts`.
