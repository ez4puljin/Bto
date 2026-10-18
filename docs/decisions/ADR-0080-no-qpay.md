# ADR-0080: No QPay anywhere — customers pay cash or by bank transfer, recorded by the accountant

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0018 #1–#5, #7 and #8 (the QPay provider, payment intents, callback-then-check, the sweep, QR for large invoices, QR at the door, second QR providers); ADR-0018 #6 (bank statement import and matching in delivery 10, the Khan Bank gateway puller later) stands |
| Amends | ADR-0017 (the e-Barimt fallback is the certified relay vendor only; QPay `ebarimt_v3` is no longer an option), ADR-0060 (QPay is no longer "deferred"), ADR-0079 (the customer app has no payment screen) |

## Context

ADR-0018 made QPay Merchant v2 the single QR payment rail: the driver would show a QR at the door (delivery 5), the customer app would pay invoices (delivery 6), and a payment would be recorded only after `payment/check`. ADR-0060 recorded that payments are entered by hand from cash and internet banking and that QPay waits for delivery 5. No QPay merchant contract was signed (Week 0 #6), and no QPay code exists (the till's tenders are cash and card, ADR-0064).

During the customer-app interview (2026-10-18) the owner answered «QPay хэрэггүй» for the app and, asked again, extended it to the whole system: drivers and the supermarket do not take QPay either.

## Decision

1. **No QPay integration.** No `integrations/qpay`, no `payment_intents`, no webhook route, no `qpay.check` or `qpay.sweep` jobs, no QR on any screen, no SocialPay or Byl provider.
2. **How payments arrive:** the accountant's vouchers (cash handed in by customers and drivers, bank transfers seen in internet banking — ADR-0060), the till's cash and card tenders (ADR-0064), and from delivery 10 the bank statement import with matching (ADR-0018 #6). A payment is still recorded only from these verified sources (SPEC §6.12 #1).
3. **Customers** pay cash (to the driver or the office) or by bank transfer with the invoice number in the transfer's description. The customer app shows the company's bank accounts for that (ADR-0079 #7) and has no payment screen.
4. **Drivers** collect cash only; their cash sessions stay (delivery 5).
5. **e-Barimt payment codes** in use: `CASH`, `PAYMENT_CARD`, `BANK_TRANSFER`. `BANK_TRANSFER_QPAY` is not used.
6. **The e-Barimt fallback** at the certification gate (ADR-0017, SPEC §11 #1) is the certified relay vendor only; QPay's `ebarimt_v3` is no longer a path.
7. **Plans dropped:** Week 0 #6 (the QPay merchant contract), SPEC §11 #16 (QPay sweep and callback questions), architecture §9.2, QPay in delivery 5 and delivery 6 and in the go-live list (production credentials, callback URL).
8. A later need for a QR rail (for example at the supermarket) is a new ADR.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| QPay in the customer app only | The owner does not want QPay in the app. |
| QPay for drivers only | The owner chose to drop it everywhere. |
| Build QPay against the sandbox now, switch on later | Work and a contract the owner does not want. |

## Consequences

**Positive.**
- No merchant contract, no ~1 % fee, no callback endpoint exposed to the internet, one integration fewer to run alone.
- Delivery 5 shrinks to deliveries, the driver app and notifications.

**Negative.**
- No instant, self-confirming payments: bank transfers wait for the accountant until the statement import (delivery 10).
- Drivers carry cash.
- If ITC does not confirm the in-house certification by the gate, only the relay vendor remains as the e-Barimt fallback.

**Follow-ups.**
- The documents drop QPay from scope, roadmap, Week 0 and the go-live list (SPEC, architecture, STATUS, CLAUDE.md), 2026-10-18.
- Delivery 10: the bank statement import and matching (ADR-0018 #6).

## Related

ADR-0017, ADR-0018, ADR-0060, ADR-0064, ADR-0079, `docs/architecture.md` §9, `docs/SPEC.md` §6.11, §6.12.
