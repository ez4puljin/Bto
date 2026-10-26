# ADR-0107: Erkhet's customers into Bto, with customer categories and codes by category

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-24 |
| Deciders | Owner («Эрхэт дээрхи нийт бүх харилцагчдын … мэдээллийг оруул. Харилцагчдын ангилалаар. Хархорины харилцагчдыг оруулах шаардлагагүй», 2026-10-24, and five rounds of questions the same day), Claude (Claude Code worker session started by «Bto удирдлага») |
| Migration | `0045_customer_categories` (reserved by the coordinator) |
| Amends | ADR-0036 (the CUSTOMERS sheet gains four columns), partners' code suggestion (`nextNumericCode`) |

## Context

The owner exported every Erkhet partner (1,663 rows, 82 groups) and asked Bto to take the customers by their Erkhet group, without Kharkhorin. Kharkhorin is a separate ХХК with its own installation (ADR-0084). Suppliers are already in Bto (ADR-0098). Erkhet's groups mix four kinds: Kharkhorin's, suppliers, staff and internal accounts, and real customer groups (Mörön's хороо and markets, the сумд, Ulaanbaatar, organisations, individuals).

Bto had no customer group. Customer segments (ADR-0049) are saved conditions, and only product segments can be hand-picked (ADR-0052). The CUSTOMERS import read no kind, no group and no contact person. A new customer's code was the largest code + 1. Erkhet's codes start with their region (1xxxx Mörön, 2xxxx сумд, 5xxxx хороо…) and include 7-digit numbers and a 99999, so «largest + 1» would have given 5,633,959.

## Decision

1. **Customer categories.** The table `customer_categories` holds a name (1–80, unique by search key), an order and an active flag. Categories are never deleted; a retired one stays on its customers and leaves the pickers. `customers.category_id` is optional. Office staff keep the list (`partners.customers.manage`), and every reader of customers reads it. Screens:
   - the «Харилцагчийн ангилал» page under «Харилцагч»; a category's name opens its customers;
   - the customer list's «Ангилал» column (shown by default) and filter (`?category=`);
   - the select on the create and edit forms;
   - the detail card.

   A retired category refuses new customers with `CUSTOMER_CATEGORY_INACTIVE` (409).
2. **Codes by category.** A new customer's suggested code is its category's largest code + 1, at the same width, stepping over codes other categories took. A category without customers, or no category, falls back to the old rule. The create form asks again when the category changes and replaces the code only while the office has not typed its own. A create without a code allocates the same way under the code lock.
3. **What is imported** (owner, 2026-10-24):
   - **Left out:** Kharkhorin's groups (210, 212, 82, 83, 84, 841–845, 86, 87, [22], [23] and [2] Өвөрхангай Оргил-Хорум), the suppliers [13] and 11099.
   - **Taken:** everything else, including staff and internal accounts (110, 111, 113, 114, [11], 00003), 0 «ХАРИЛЦАГЧИД» and [14].
   - **Categories:** each kept group becomes a category named as in Erkhet, in the map's order. Groups of the same name share one (511 and 511 {2} → «11-р хороо»); Баруун / Зүүн бүс stay apart.
   - **Settlement group:** «Мөрөн» for Mörön's хороо, markets, 130/131/134, [500][1]/[2], organisations 701/[700], individuals 112/005, staff and internal, 0 and [14]. «Орон нутаг» for the сумд (201…225, 2123, 2135, 2146, 656, 956) and 132 УБ хот.
   - **Kind:** «Хувь хүн» for 112, 005, 110, 111 and 113; every other customer is «Байгууллага». The file has no registration number or TIN.
   - **Phones:** the first mobile number goes to «Утас», the second becomes a contact person with no name. A third number, a landline or other text goes to the note.
   - **The «мэйл» column:** a mobile number fills the phone, or the contact when the phone is taken. Text fills an empty address. E-mails, 7-digit numbers and the rest go to the note. Bank cells go to the note too.
   - **Not imported:** the credit limit (blank: no limit, ADR-0060) and Erkhet's «НӨАТ төрөл», whose meaning nobody knows; the payer flags stay unchecked.
   - **Code repair:** the one code with a letter takes the next free code of its category, and the Erkhet code is kept in the note.
   - **No clash with the test store:** Bto300's test store has code «1»; Erkhet has «001», a different code.
4. **The CUSTOMERS sheet gains four columns:**
   - «Төрөл (Байгууллага / Хувь хүн)»: it overrides the guess from the numbers. A change on an existing customer must still fit its TIN and consumer number, otherwise `kind` NOT_ALLOWED.
   - «Ангилал»: an active category by name; an unknown one is NOT_FOUND, a retired one NOT_ALLOWED.
   - «Холбоо барих хүн» / «Холбоо барих утас»: a contact person, added when the customer does not have them yet.

   A revert gives the kind and the category back where they still hold the imported value. Added contacts stay, like added addresses.
5. **The migration tools hold no data** (as ADR-0098):
   - `tools/migration/erkhet-customers-map.json`: the owner's decisions, group codes only;
   - `erkhet-customers-rules.mjs`: the pure rules, proved on synthetic rows in `lint:guards`;
   - `erkhet-customers.mjs`: converts the export to `customers.xlsx` and `categories.json` with a report;
   - `erkhet-customers-load.mjs`: creates the categories over the API, then runs the CUSTOMERS import.

   An Erkhet group the map does not name stops the conversion. The export and every converted file stay in the gitignored `tmp/`.

## Consequences

- The office can group customers now. Later work (sales reps' zones, reports by region) can read the category.
- Customer segments cannot yet use the category as a condition. That is the next step if the owner wants it.
- **The real load** runs on `bto_main` after this branch is merged: 1,403 customers in 64 categories (Мөрөн 638, Орон нутаг 765). The stores become linkable in «Bto300» through the «Апп» card and show in the rep app.
- At go-live the same tools run against the production database, with a fresh export if the owner's Erkhet list changed.
