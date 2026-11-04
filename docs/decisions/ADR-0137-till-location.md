# ADR-0137: an edge server has no warehouse; each till names where its sales leave stock

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («Мөрөнд одоо ганц л дэлгүүр … ганц Касс сервер … дотроо 2 тусдаа байршилаас үлдэгдэл хасагддаг 2 пос … edge бүртгэхдээ байршил сонгодоггүй. Зөвхөн пос нэмэхдээ аль байршлаас үлдэгдэл хасагддаг байхыг тохируулдаг … агуулахыг ч сонгож болдог», 2026-11-04; the SALESFLOOR on demand was the recommended answer, the owner had no preference), Claude (the direct-mode session) |
| Supersedes | ADR-0063 #1 (an edge serves a STORE warehouse), ADR-0123's branch rule and default |

## Context

ADR-0063 gave each edge server a STORE warehouse; ADR-0123 then let a till sell from its own STORE warehouse, by default the edge's and only within the edge's branch. In Mörön one supermarket has one edge server and two tills that sell from two places with their own stock. The owner sees the edge's warehouse as a needless choice: the place belongs to the till, and it may also be a wholesale warehouse.

## Decision

1. **The edge server has a code and a name only.** `pos_edge_nodes.warehouse_id` is dropped (migration `0066_pos_till_location`); the snapshot's `node` carries id, code and name; the link answer no longer names a warehouse.
2. **Each till names its location, required.** `POST /pos/tills` requires `warehouseId`: a STORE (a store's floor) or a WHOLESALE warehouse of the company (`TILL_WAREHOUSE_KINDS`); the edge's branch no longer limits it. The admin form calls it «Үлдэгдэл хасах байршил» and lists the store floors and the warehouses apart.
3. **A wholesale warehouse gets a SALESFLOOR.** A till sells from its warehouse's SALESFLOOR (ADR-0123 unchanged). A WHOLESALE warehouse has none until a till is set to it; `SystemBinsService.ensureSalesfloor` creates it in the same transaction. Goods reach it by a bin move or a transfer; a sale beyond what is there is adjusted in as a `POS_SHORTFALL` and listed for the keeper, as on a store's floor.
4. **What used the edge's warehouse:** a bonus card's manual points entry takes the active tills' warehouses as its journal dimension; the «Бүтэц» page shows an edge under each store its tills sell from.
5. **On screens a till is «Пос»** (owner, 2026-11-04: «Касс гэхгүй. Пос гэж явна»): «Пос», «Пос сервер», «Посын борлуулалт» in the admin, the POS app and the POS errors; the money «касс» of finance keeps its name, and the cash drawer is «мөнгөний хайрцаг».
6. **The printer is the cashier's PC's** (owner: «Cashier өөрийн кассын програм тохиргоо дотроо printer сонгодог … энд огт Printer тохиргоо байх ёсгүй»; «Касс хайрцаг хэвлэгчээр нээгдэх гэсэн тохиргоо огт байх ёсгүй»): the admin's POS form has no printer address, port, name or drawer switch; the POS app's «Тохиргоо» explains the Windows default printer, opens Windows' printers page and prints a test slip. The columns stay in `pos_tills` unused (nothing on the edge reads them).
7. **A new POS opens its cashiers next** («Кассчид ба эрх», ADR-0124's lists), and the edit dialog leads there.

## Consequences

- One edge serves any number of tills in different places; the admin chooses a till's place once, when adding it.
- Selling straight from a wholesale warehouse works only through its SALESFLOOR: stock on its shelves is not taken by the till, so the keeper moves goods to SALESFLOOR (or reads the shortfall list).
- Old snapshots on an edge still carry the node's warehouse fields; nothing reads them.
