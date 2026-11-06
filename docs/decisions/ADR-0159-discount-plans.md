# ADR-0159: The discount programs take the pricing plans' conditions

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Үнийн төлөвлөгөө дээр хийдэг нөхцлүүдийг Bto үнийн тохиргоонд нэвтрүүлэх», «Давуу эрхтэй нь ганцаараа», «Тоонд багтаж хөнгөлнө»), Claude (Claude Code session) |
| Supersedes | ADR-0041 #2: a program is edited or deleted only before it starts; every program in force stacks. Everything else in ADR-0041 #2 and #3 stands |
| Amends | ADR-0048 #7 (a program may serve both channels, and only named pipelines or tills); ADR-0092 #3 and #7 (a badge for N+M; N+M and steps with a rule are never unconditional) |

## Context

The owner runs promotions in Erxes' «Pricing plans»: filters and a list with who made each plan and when, and a form where a plan applies to a supplier, a category, chosen products or a segment, leaves out products or others of the chosen kind, serves named places, gives 1+1 and rounds the price it comes to. Bto's «Хямдралын тохиргоо» had one product, one category or the order, and nothing else. The owner wants these conditions in Bto's own settings rather than a second module beside it, with the old conditions kept.

## Decision

1. **What a person does with a program.**
   - `state` is what they set: `ACTIVE`, `DRAFT` or `ARCHIVED`. Only `ACTIVE` applies, and only within its dates.
   - The screens read state and dates as one status: `DRAFT`, `SCHEDULED`, `ACTIVE`, `ENDED`, `ARCHIVED`. Erxes' «completed» is `ENDED`: by its end date or «Зогсоох».
   - A program may be edited at any time. Orders keep the prices frozen at their submit, the store edge's sales keep theirs, and the audit keeps what the program was (before and after, with its links). A running program keeps its first day when edited; a new first day is today or later.
   - Archive takes it out of quotes and of the list until the archived filter is chosen; «Сэргээх» brings it back by its dates.
   - Delete is at any time and sets `deleted_at`: out of every list and quote, the row stays, as business data does, and orders' frozen discounts still name it.
2. **What it applies to.** `scope` still says how it counts: `PRODUCT` each product on its own, `CATEGORY` the products together, `ORDER` the whole order.
   - `target_kind` (`PRODUCT`, `CATEGORY`, `SUPPLIER`, `SEGMENT`) and its links name a set in place of the one product or category. The old shapes stand, and a form with one product or one category counted together writes them.
   - The set is read when a quote runs: a category with its subtree, a supplier's linked products (any link, not only the main one), a segment's members through catalog's `PRODUCT_SET_RESOLVER`, less the excluded targets of the same kind and the excluded products. A product joining a supplier or a category counts at once; a segment's members are read at most once a minute per process, and afresh when a plan is saved.
   - An archived or removed segment keeps no products, so a plan on it applies to nothing and no quote is refused.
   - In a set a new price or tugriks off are per base unit, times the line's unit.
3. **N+M (`BONUS`).** Of the product's quantity in the cart, in base units, every N+M has M free: `floor(qty / (N+M)) × M`. It is a discount on the line, taken at what the units cost after the product's other programs, split over its parts; the quantity written, the reservation and the stock movement do not change. It is stored as one step, threshold N and value M, and needs one whole N+M to start. Only each product on its own: a free item across different products is not asked for.
4. **Priority.** A `priority` program that reaches its condition on a product's part takes that part alone, the newest if several; other programs do nothing to it. A priority program below its condition has taken nothing. Such a part still counts towards category and order thresholds but takes no discount from them. A till's coupon still applies: it is the customer's own. Only a program counting each product on its own may have priority.
5. **Where it serves.** `list` is `WHOLESALE`, `RETAIL` or `ALL`. Links name pipelines and tills; none named means all of them in the channel. A place unknown to the quote (the calculator, a rep's preview, a card) takes only programs that name none. Pipelines rather than stages, because a price freezes once, at submit. Bto300's and the rep's cards and previews count for their channel's default pipeline. Pipelines and tills live in modules that follow pricing, so their ids are not checked; the form offers only real ones and an unknown id never matches.
6. **Conditions.** A step has a rule: `MINIMUM` from its threshold on (as before), `EXACT` only at it, `EVERY` at its multiples. The highest step met wins. A program measures one thing, a quantity or an amount; a product may now be measured by its amount at list prices. One value without conditions is one step from zero.
7. **Rounding.** A program counting each product on its own may round the unit price it leaves: `ROUND`, `FLOOR` or `CEIL` to a multiple of a factor, or `ENDS_9` down to the nearest price ending in 9, 99 or 999. A rounded price is held under the price the program started from, and a result of zero or less keeps the price unrounded. N+M has no unit price to round. Erxes' «Truncate» is left out: on prices it is the same as «Floor».
8. **The store edge.** The snapshot carries each plan's expanded products (only those the store sells), its priority, rounding, tills and step rules; the edge filters by the till and runs the same resolver, offline. Fields appear only when a plan uses them, so a snapshot without plans keeps its version.

Not built, because the owner's list leaves them out and they are named here so they are not assumed: Erxes' Repeat and product Expiry; Tag and Bundle targets (Bto has neither); a plan measuring quantity and amount at once; stages and branches or departments as places.

## Consequences

- Every quote reads a little more: one read per distinct supplier, category or segment among the plans in force. Hundreds of plans on chosen products cost nothing extra.
- A segment read inside a submit's transaction takes a second connection for that read when its minute has passed. It is short and the pool has room at today's traffic; if it ever matters, warm the plans before the transaction.
- Old programs and their API keep working: every new field is optional and defaults to what a program always was.
- An installed Bto300 or staff app older than this reads an N+M badge's label correctly but its sentence wrongly until the next APK.
