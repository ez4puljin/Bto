# ADR-0160: Price profiles read and change like the discount plans

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner (of `/pricing/profiles`: «энэ тохиргоог мөн ийм болго»), Claude (Claude Code session) |
| Amends | ADR-0048 #1 (an archived profile can be brought back; a profile can be deleted), #3 (the create dialog and the two change dialogs become one page). ADR-0048's rules on versions, on values and on who may change them stand |

## Context

After «Хямдралын тохиргоо» took the shape of Erxes' pricing plans (ADR-0159), the owner asked for «Үнийн тохиргоо» to be the same: filters on the left, who made each and when, and edit, archive and delete on the row, with a page rather than dialogs to change it.

## Decision

1. **The list.** Filters on the left (status, rounding, the supermarket's bulk price, whether products use it) and a search by name. Each row shows its name, status, today's values, its products, who made it, when it was made and changed, and pencil, archive and delete. The rounding, bulk and use filters read today's values. An archived profile has no pencil: it is brought back first, because an archived profile takes no new values.
2. **Status.** `ACTIVE` when values are in force today, `SCHEDULED` when its first values start later, `ARCHIVED`. The list's default stays every live profile; the `archived` query stands beside `status`.
3. **One page to change it.** `/pricing/profiles/new` and `/pricing/profiles/:id/edit` hold the name, the day, the markups and the rounding, with the example beside them. `PUT /price-profiles/:id` saves the name and the values in one transaction.
   - The name changes at once. Values change from the chosen day, as ever: the version in force that day closes and the old values stay in the history.
   - Values equal to those in force that day write no version, so a rename alone writes one change.
   - `PATCH` and `POST :id/versions` stay for the callers that use them.
4. **Restore.** An archived profile can be brought back with its values as they were. A live profile of the same name refuses it (`DUPLICATE_VALUE`).
5. **Delete.** Refused while a price in force today or planned uses it (`PRICE_PROFILE_IN_USE`), like archiving. It sets `deleted_at` and also archives the row: it leaves every list and every choice, its name is free again, and earlier price terms still point at it and show its name. The audit keeps it.
6. **Two groups.** The form and the example read the markups as «Борлуулалт» (whole packs at the warehouse price, loose pieces with their markup: 5 boxes and 5 pieces is 5 boxes at the base price, 5 pieces marked up) and «Супермаркет (касс)» (its markup and bulk price). A new profile's loose markup starts at 0. The owner chose not to tell tills apart here: every till sells a product at its profile's one supermarket price, as before.
7. **Its products.** The profile's page, its form and the count in its row link to `/catalog/products?profile=:id` in a new tab, the product list's own filter already on.

Not added: a draft state. A profile changes nothing until a product takes it, and its first day can already be in the future.

## Consequences

- Nothing about prices changes: this is how a person finds and changes a profile, with no new rule for a quote.
- The price sheet import and the assistant no longer see deleted profiles; `ai.price_profiles` is recreated (migration `0077_price_profile_delete`).
- `pricing.manage` still decides who changes a profile; every signed-in user still reads them.
