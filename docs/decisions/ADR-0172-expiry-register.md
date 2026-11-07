# ADR-0172: The expiry register, on the web and in the staff app

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Owner («/expiration цэсийг судалж, Bto системд нэвтрүүл. Ажилтны апп дээр хугацаа илрүүлэлт цэс байх ёстой»), Claude (a worktree session, without an interview) |
| Related | ADR-0019 (lots, not this), ADR-0098 (product codes), ADR-0118 (a save never overwrites another person's input), ADR-0131 (every staff member has the staff app), ADR-0162 (AI data groups), ADR-0165 (rights editable on «Дүрүүд») |
| Migrations | `0090_expiry` |

## Context

The old system's `/expiration` page is in daily use. Staff scan a product, type the date printed on it and how many pieces they counted on the sales floor and in the warehouse. Someone later decides what happens to it: it goes back to the supplier in the city, is sold at an internal discount, or is archived once it is gone. Someone may be held liable. It holds a few hundred open records and more archived ones. Every signed-in user can read and write everything on it.

Bto had no such thing. ADR-0019 prepared `lots` and FEFO for a later session, which is a different matter: a lot belongs to the ledger, is required on receipts, and changes which stock is picked. This register observes what is on the shelf and moves nothing.

What the old data shows: the discount and city-return statuses stand unused at the moment, liability is rare, nearly every record was typed under one shared `admin` login, and about one open record in five repeats a product and date already open, because nothing tells the person it is there.

## Decision

1. **A module of its own, `expiry`, separate from `lots`.** It owns `expiry_items`, `expiry_item_changes`, `expiry_item_roles` and `expiry_item_users`. It never writes the ledger, reserves nothing, and ADR-0019 stays as it stands. If lots are activated later, the register stays an observation log.

2. **A record is a product, a date, two counted quantities, a status, a liability and a note.** Quantities are in the product's base unit, NUMERIC(14,3), whole unless the base unit is fractional. A record starts with at least one positive quantity; a later edit may bring both to zero. The status is `REVIEW`, `CITY_RETURN`, `INTERNAL_SALE` or `ARCHIVED`. The old status words stay on screen. The date may lie in the past, because finding expired goods is the point; it may not be more than 5 years back or 15 years ahead, which stops a typing slip. An inactive product can still be recorded: the goods are on the shelf.

3. **Never deleted; archived.** `DELETE` and `TRUNCATE` are revoked from the app role on the records, and `UPDATE` too on the history. A quantity change adds a history row with both old and new values, who and when. A record's creation is its first history row. An archived record's date, quantities, note and status stay as they are until it is restored, which puts it back in `REVIEW`; its liability may still be decided, since that often comes after the goods are gone. Every write is audited as well.

4. **Who may do what.** Reading, recording and correcting a date, quantities or note is open to every signed-in staff member (`@Authenticated()`), as the old page was and because the person standing at the shelf finds the goods. Status and archive take `expiry.items.manage`: ADMIN, OFFICE, PROCUREMENT, WAREHOUSE, ACCOUNTANT, POS_SUPERVISOR by default. Liability takes `expiry.liability.manage`: ADMIN, ACCOUNTANT, HR by default. This narrows the old page on purpose, since liability reads as pay; the owner can change it on «Дүрүүд» (ADR-0165). **TODO-VERIFY:** the owner confirms who may assign liability. Carrying old records takes `expiry.items.carry`, ADMIN only.

5. **A second record for the same open product and date is refused unless the person says so.** `POST /expiry/items` answers 409 `EXPIRY_ITEM_EXISTS` with the open record's id; the screens offer to open that record or to add a new one anyway, which sends `allowDuplicate: true`. Choosing a product also lists its open records first. It is not a database rule: the carried data holds such pairs, and two lots of one date can be real.

6. **A save never overwrites someone else's input (ADR-0118's rule).** `PATCH` carries the `expectedVersion` the screen read; a record edited since answers 409 `EXPIRY_ITEM_CHANGED` and the screen reloads it while keeping what was typed. The version counts date, quantity and note edits only, so a status or liability decision does not refuse a count in progress. Status and liability are single choices without a version.

7. **The product's honest columns.** The old «Брэнд» column holds the supplier: Bto shows the main supplier (Bto has no brands, ADR-0098). The old «Байршил» tags become the product's home warehouse (ADR-0033, ADR-0098 #5). The code is `products.sku`. All three are read live per page through the owners' public services; product columns are not copied onto the record.

8. **The web page `/inventory/expiry`, «Хугацааны хяналт», under «Агуулах».** Everything the old page has: the four counts, the status and date filters, supplier, warehouse, author and liability filters, the columns, add with a scanner or camera, correct, status, liability, history, archive and restore, and an A4 landscape print of what the filters show. Bto's kit replaces the old markup, so a row opens a record panel instead of editing inline. The menu entry needs no right.

9. **The staff app's «Хугацаа илрүүлэлт».** A tab on the work bar for everyone who has it, and a link on a rep's home and profile, since a rep has no work bar. It lists records by urgency, scans with the camera or searches, shows a product's open records, records a date and two counts with «Хадгалаад дараагийн бараа» for walking a shelf, and corrects a record. Holders of `expiry.items.manage` change status and archive there. Liability is shown but assigned on the web only: a phone is the wrong place for that choice. The app has no offline mode (ADR-0020), so a failed save stays on the screen. Version 0.13.0.

10. **The old digest becomes two home tiles; no notifications.** The old system's daily digest counted what is expired and what expires within seven days. Bto has live attention tiles, so `GET /expiry/attention` feeds two of them for holders of `expiry.items.manage`. No push or per-person message is sent: push does not exist and ADR-0062 #7 leaves sending by person to the owner.

11. **The AI assistant reads `ai.expiry_items`,** in data group `stock`, with a glossary line and an example, as the old system's assistant could answer «which goods expire within N days». The liability is left out of the view.

12. **Old records come through `tools/expiry-carry`.** It reads a gitignored dump and posts to `POST /expiry/items/carry`, which is idempotent on the old record's id and keeps what the ordinary routes cannot: the old author's name, the dates and the history. A later run brings new old rows and refreshes rows nobody has touched in Bto, and leaves a touched row alone, so it can run again until the old page stops. Names are stored as text (`created_by_name`, `archived_by_name`, `changed_by_name`) on every row, a snapshot for rows made in Bto: old names belong to no Bto user and the shared `admin` must not be credited to anyone. Old liability roles and people that have no sure Bto match go into the liability note as text.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Use `lots` with `expiry_date` | Lots need a required lot number, belong to the ledger, and activating them changes receipts and picking. The owner asked for the register, not FEFO. |
| Link the quantities to the stock ledger | The counts are what someone saw on one shelf at one moment, and the old page never tied them to stock. Writing them to the ledger would be a stocktake without its controls. |
| A unique index on open product and date | The carried data breaks it, and two lots with one date can be real. A refusal the person can pass tells them what they need to know. |
| Replacing a row's history on a re-carry | History is append-only; a re-carry appends only old changes not yet present, by the old change's id. |

## Consequences

**Positive.** The floor staff use the same phone they already have; repeats are caught at the shelf; the old data and its history survive.

**Negative.** Two systems accept records until the old page stops, so the tool must run once more at the cut-over. The list reads other modules per page, so it cannot sort by product name in SQL, and a supplier or warehouse filter walks the register's own distinct products, which is cheap while the register holds thousands of rows and not millions. Staff phones need the new APK by hand.

**Follow-ups.** Lots and FEFO remain ADR-0019's. Automatic per-person alerts wait for the owner (ADR-0062 #7).

## Related

`docs/modules/expiry.md`, `docs/modules/mobile.md`, `docs/modules/ai.md`, `tools/expiry-carry/README.md`.
