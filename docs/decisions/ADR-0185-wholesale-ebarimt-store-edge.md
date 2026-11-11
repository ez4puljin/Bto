# ADR-0185: The wholesale centre's e-Barimt issued by the store PC's PosAPI, pulled and relayed by the store edge

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-11 |
| Deciders | Owner (2026-11-11: «Дэлгүүрийн pc дамжуул»), Claude (Claude Code session: the relay's protocol, the states and the screens) |
| Amends | ADR-0017 (topology: the wholesale receipts are issued by the store PC's PosAPI on the store LAN, not by an office box over Tailscale; no `billIdSuffix`, no `ebarimt_config`, no `ebarimt.issue` job), architecture §5.9 and §9.1, ADR-0074 #3 (`MODULE_DEPS.ebarimt` is `['identity']`, not `[]`: the audit and the rights; the request by value is unchanged), ADR-0063 #4 and ADR-0067 #8 (two more routes on the edge's channel, the edge's migration `0008`, one more loop). ADR-0065's till path is unchanged |

## Context

The invoice exists since Finance I (ADR-0060); its e-Barimt receipt never did. ADR-0017 planned an office mini-PC with PosAPI reached over Tailscale; ADR-0065 gave the supermarket's tills a path of their own through the store edge and left "the wholesale centre's reachability" open (pending decision #31): the centre runs on an external server, a PosAPI is never public, and the store's PosAPI is on a LAN behind NAT.

The old system (erxes, studied read-only on 2026-11-11) never reaches the store PC either: its one receipt-issuing deal stage calls the vendor's hosted PosAPI, where the company is one of 103 merchants. The owner was offered three paths — the vendor's hosted PosAPI, a PosAPI of Bto's own on its server, or the store PC's PosAPI through the store edge — and chose the third on 2026-11-11: one PosAPI and one `posNo` for the company's receipts in Mörön, no new contract, no inbound network path into the store.

Facts that shape the design: PosAPI has no authentication and must never be exposed (architecture §9.1); a `POST /rest/receipt` that times out may still have made a receipt, so a blind retry duplicates it (ADR-0017); the lottery and the QR data may exist only for printing (CLAUDE.md NEVER, ADR-0022); the edge already holds a token-authenticated HTTP channel to the centre that it opens itself (ADR-0063 #4) and already issues receipts at that PosAPI with `buildPosapiReceipt` (ADR-0065).

## Decision

1. **Pull relay.** The centre never calls the store. The store edge asks the centre for one receipt operation at a time on its existing channel, with its node token: `POST /pos/sync/ebarimt/claim` → `{ operation }` (an ISSUE with the business request, a CANCEL with the ДДТД and the verbatim date, or null) and `POST /pos/sync/ebarimt/result` (`RelayResultWire` of `@tugeel/shared/mn`). The routes live in `pos` (`EdgeTokenGuard`), the logic in the new module `modules/ebarimt`. Any active edge node of this installation may ask; there is one company and one PosAPI merchant.

2. **`ebarimt_receipts`** (migration `0100_ebarimt_receipts`), owned by `modules/ebarimt`, keyed by the source document as ADR-0074 decided: `company_code`, `source_system` (`BTO`), `source_doc_type` (`SALES_INVOICE`), `source_doc_id` (the invoice id as text, no foreign key), `source_revision` (1), unique together. It stores the business request — receipt type, `customer_tin`, `consumer_no`, `lines` and `payments` as jsonb, the totals — and what the list shows (`doc_number`, `order_number`, `buyer_name`). It does **not** store the merchant's TIN, `posNo`, district or branch number of the request: the edge adds them from its own PosAPI facts and the store's settings, exactly as for a till's receipt (`buildRelayReceipt` → `buildPosapiReceipt`). After the issue it keeps the facts PosAPI answered: `ddtd`, `posapi_date` verbatim, `issued_at`, and the merchant's TIN and name the edge reported (for the printed receipt). Never a lottery or QR data: there is no column for them. `REVOKE DELETE, TRUNCATE` from `app`.

   States: `PENDING` (waits for an edge, `next_attempt_at`), `SENDING` (claimed: `attempt`, `claimed_at`, `claimed_node_id` + code), `CONFIRMED`, `ERROR` (`error_code` + `message`), `INDETERMINATE`, `CANCELLED`. A cancellation is a second, nullable state on the same row: `cancel_status` `PENDING` / `SENDING` / `DONE` / `ERROR` / `INDETERMINATE` with its own attempt, claim and message.

   The centre checks a request when it is prepared (`checkRelayReceipt`: the request built with placeholder merchant facts), so a VAT-free line without its tax product code, a malformed classification code, a bad TIN or payments that do not make the total are caught before any edge asks. A line **without** a classification code passes: the store's default code («Супермаркет → Тохиргоо → Баримт ба e-Баримт») fills it, as it does for the tills — a product catalogue with few codes of its own would otherwise block every receipt.

3. **When a receipt is prepared.** A switch on a sales stage, `sales_stages.ebarimt` (default false; `CHECK`: only on a `SALE` stage; «e-Barimt гаргах» in the stage dialog). The sale passes it in `SaleSnapshot.ebarimt`; `InvoicingService.onSold` calls `InvoiceEbarimtService.prepareInTx` after the invoice, in the sale's transaction, which builds the request from the invoice (buyer from partners, codes and barcodes from catalog) and calls `EbarimtReceiptsService.prepareInTx`. No migration turns the switch on: the owner ticks it. A data problem never fails the sale: the row is written `ERROR` with its reason (`TIN_PENDING`, a build error code) and listed for the accountant.

4. **Type and payments.** COMPANY with a TIN → B2B with `customerTin`; COMPANY without a TIN → no receipt yet (`ERROR` / `TIN_PENDING`); INDIVIDUAL with a TIN → B2B, otherwise B2C with the 8-digit `consumer_no` when known (`wholesaleReceiptType`). One payment for the invoice's total: `CASH` → `CASH`, `BANK_TRANSFER` → `BANK_TRANSFER`. **A `CREDIT` order gets no receipt in this version** — no row at all — until the accountant says which PosAPI payment code a credit sale carries and when its receipt is due (TODO-VERIFY; the till's credit sales get none either, ADR-0109). The screens say so.

5. **Exactly once, never a blind retry (ADR-0017).**
   - The claim moves one row to `SENDING` under `FOR UPDATE SKIP LOCKED` and raises its `attempt`.
   - The edge stores the claimed operation in `edge_relay_ops` (edge migration `0008_wholesale_relay`, unique on receipt, operation and attempt) **before** it calls PosAPI (`CLAIMED`), marks it `CALLING` for the call, and stores the outcome after (`DONE`). It reports every settled operation until the centre acknowledges (`reported_at`).
   - Outcomes: issued → `CONFIRMED`; PosAPI's `ERROR` / `PAYMENT`, or a request the store could not build (`EDGE_BUILD`: no district or default classification code) → `ERROR`; PosAPI unreachable before the request left (`NOT_SENT`) → `PENDING` with a next try (30 s doubling to 30 minutes), the next claim being a new attempt; a timeout or a cut answer → `INDETERMINATE`.
   - An edge restart finds an operation `CALLING` → reported `INDETERMINATE`.
   - A `SENDING` row with no result for ten minutes reads `INDETERMINATE` (and is written so by the next claim or decision); a late result of that attempt still applies while no person has decided.
   - A row an edge holds is handed to **the same edge** again with the same attempt (its answer to the claim was lost): the edge calls PosAPI only for an operation it has stored, so a row it does not know was never sent.
   - A result is applied once: a repeat, or a report of an older attempt, is acknowledged and changes nothing; an unexpected "issued" (an older attempt, another ДДТД) is audited as `UNEXPECTED_RECEIPT` for a person to see.
   - `INDETERMINATE` is never re-sent automatically. The accountant looks the receipt up on ebarimt.mn and either types the ДДТД and date (`CONFIRMED`) or says «Гараагүй» (`PENDING` again). `ERROR` is retried only by a person: «Дахин бэлтгэх» rebuilds the request from the invoice with today's data (`POST /invoices/:id/ebarimt`).

6. **The lottery and the QR data are never persisted or logged.** The edge keeps them in its process memory until the result call that carries them is acknowledged (30 minutes at most). The centre takes them off the result in `EbarimtRelayService.result` and puts them only into `ReceiptSecretsCache`: the api process's memory, one print, 30 minutes, 500 receipts. They reach no table, no audit row, no log line (request bodies are never logged; `lottery` and `qrData` are also on the logger's redact list) and no idempotency record (the routes carry no `Idempotency-Key`). `POST /ebarimt/receipts/:id/print` hands them out once with `Cache-Control: no-store`; every later print, and every print after a restart, is a copy («ХУУЛБАР») without them. Tests scan every table of both databases, the audit and the logs.

7. **Cancel.** Voiding an invoice (`InvoicingService.void`) calls `requestCancelInTx` in the void's transaction: a receipt never issued (`PENDING`, `ERROR`) is `CANCELLED` at once; one issued gets `cancel_status = PENDING` and the edge relays `DELETE /rest/receipt` with the ДДТД and the verbatim date; one in flight or `INDETERMINATE` is cancelled as soon as it is known to exist, or closed when it is known not to. A refused or unanswered cancellation waits for the accountant: «Цуцлалт дахин илгээх» (a `DELETE` makes no receipt, so repeating it is safe) or «Цуцлагдсан гэж тэмдэглэх». **Not in this version:** partial returns and credit notes through `inactiveId` — a credit note changes no receipt yet.

8. **Edge switch.** `EBARIMT_WHOLESALE_RELAY` (default off) in the edge's environment; the loop (`ebarimt-relay`, every 5 s, 0.5 s after work, 15 s when the centre is away) runs only with it on and `EBARIMT_PROVIDER=posapi`. Two switches must both be on before anything is sent: this one on the store edge and «e-Barimt гаргах» on a stage.

9. **Screens and rights.** «Санхүү → e-Barimt баримт» (`/finance/ebarimt-receipts`, `finance.read`): the list with status, type and search filters, counts, when an edge last asked, and per row «Хэвлэх» / «Сугалаатай хэвлэх», «Шалгах» (an `INDETERMINATE`), «Дахин бэлтгэх» (an `ERROR`) and the two cancellation decisions (`finance.invoices.manage`). The print page (`/finance/ebarimt-receipts/:id/print`, 80 mm and A4 through `PrintFrame`) shows the seller and TIN, the ДДТД, the date, the lines, the totals with VAT and НХАТ apart, the buyer's TIN and name for B2B, and — on the one print — the lottery after the word «Сугалаа» and a sharp QR code. The invoice's panel shows its receipt's state.

10. **Not built.** `ai` views for the receipts; `ebarimt_config`, `ebarimt_submission_log`, `billIdSuffix`, the `ebarimt.issue` / `sendData` / `monitor` jobs of ADR-0017 (the store edge already reads `/rest/info` and sends its PosAPI's data; the heartbeat carries it).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The vendor's hosted PosAPI, as erxes uses | The owner's choice. It would also put Bto's tax receipts on a server shared with 102 other merchants, under terms no one has written down for an in-house system, and tie them to erxes / Erkhet staying |
| A PosAPI of Bto's own on the centre's server | The owner's choice; needs the vendor's activation and a second `posNo`, and stays the plan only for the store's own box (S5) |
| An office mini-PC over Tailscale (ADR-0017 as written) | Another machine to buy, install and keep alive, and an inbound path into a private network; the store PC and its edge already exist |
| The centre pushes to the edge (a tunnel, a websocket) | An inbound or long-lived path into the store; the pull over the existing channel needs nothing new and survives the store's internet dropping |
| Relay wholesale receipts as documents in the edge's outbox | The outbox goes edge → centre; a centre → edge queue would need the same claim and result anyway |
| Refuse at prepare when a product has no classification code | Nearly every product would block its receipt today; the tills already fall back to the store's default |
| Re-send automatically after a timeout with `billIdSuffix` | Its behaviour at PosAPI is still unverified (the spike of ADR-0017); a duplicate tax receipt is worse than a receipt a person checks |
| Keep the lottery in the row until printed | Forbidden: «QR код хадгалахгүй» (architecture §9.1), CLAUDE.md NEVER |
| A receipt for credit orders with `CASH` | Would tell the tax office money was received that was not; the accountant decides (TODO-VERIFY) |

## Consequences

**Positive.** Wholesale invoices can carry real e-Barimt receipts with no new hardware, contract or open port. One PosAPI, one merchant, one nightly send for the till's and the centre's receipts. The same builder and the same no-blind-retry rule as the tills. Off until two switches are on.

**Negative.** A wholesale receipt waits for the store edge: when the store PC, its PosAPI or the store's internet is down, receipts stay `PENDING` (the list says when an edge last asked) and the buyer leaves without the printed receipt; it can be printed later, the lottery only once within 30 minutes of its issue. The receipts carry the store's district and branch number (TODO-VERIFY with the accountant: whether the wholesale centre needs a branch number of its own at PosAPI). The lottery of a receipt issued while the api restarts is lost to print. Daily volume adds to the store PosAPI's (well under its 100,000 a day).

**Follow-ups.** The owner's first real sale on a ticked stage is a real tax receipt (cancel it the same day from the invoice's void if it was a test). TODO-VERIFY with the accountant: the payment code and tax point of a credit sale; the branch number; credit notes and partial returns through `inactiveId`. The store's own PosAPI box (S5) changes only the edge's `POSAPI_URL`. `ai` views when the assistant should answer about receipts.

## Related

ADR-0017, ADR-0022, ADR-0060, ADR-0063, ADR-0065, ADR-0067, ADR-0074, ADR-0109; `docs/modules/ebarimt.md`, `docs/modules/pos.md` §3 and §9, `docs/modules/finance.md`, `docs/modules/sales.md`; docs/architecture.md §4, §5.9, §9.1; `apps/api/test/integration/ebarimt-wholesale.int-spec.ts`, `apps/api/test/integrity/ebarimt-guards.spec.ts`.
