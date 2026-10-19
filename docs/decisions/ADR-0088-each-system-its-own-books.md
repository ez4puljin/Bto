# ADR-0088: Each system keeps its own books; the resort's system copies Bto's finance module and shares nothing with Bto at run time

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0069 #9 ("one source everywhere … never a copy or a fork"), ADR-0070 #9 (intercompany between BO and the resort), ADR-0071 #9 (the outbox and HTTP intake for the PMS), ADR-0074 #4 as a shared run-time layer, ADR-0076's multi-company isolation work, ADR-0077's and ADR-0083's PMS items (A1, A2, TESTPMS, the PMS kickoff) |
| Amends | ADR-0069 #1–#4 (the core is Bto's finance module with a clean boundary, kept so it can be copied), ADR-0070 #1, #2 (one tenant and one company per installation), ADR-0083 #4 (the PMS rows leave the "after go-live" list) |

## Context

The owner (2026-10-20): «Амралтын газар энэ системтэй огт холбоогүй… Амралтын газарт зориулсан өөр систем хийнэ. Харин тэр систем дотор энд хийж буй Санхүүгийн Module ажиллах зарчим болон харагдах байдлыг авч тэнд ашиглана. Ингэснээр Амралтын газрын Санхүүгийн Module болон Bto системийн Санхүүгийн module тусдаа гэсэн үг.»

ADR-0069 … ADR-0077 read the 2026-10-18 interview as one Finance Core shared at run time. The resort's PMS would post to the core in Bto over HTTP. Both companies' books would live on one server, as one tenant with intercompany parties and company isolation.

The owner means something else. Each system has its own finance module and its own books. Only the working principles and the screens are the same.

Asked how the resort's system gets them, the owner chose to copy the code.

## Decision

1. **Separate books, no run-time link.**
   - Bto's finance module books Бүтэн-Оргил ХХК only.
   - The resort's system has its own finance module, database and books.
   - Nothing posts from one system to the other.
   - If BO sells goods to the resort, the resort is an ordinary Bto customer.
   - The Kharkhorin branch, a separate ХХК with its own installation (ADR-0084), follows the same rule.
2. **Reuse by copy.**
   - When the resort project starts, it copies Bto's finance module and develops it on its own. The copy includes `apps/api/src/finance-core/`, `packages/fin-contract`, `@tugeel/shared/mn` and the finance screens.
   - From then on the two copies are separate code; neither updates the other.
   - Bto keeps the module cleanly bounded (ADR-0069's lint rules, `pnpm core:standalone`), so the copy is easy. The boundary is kept for that reason, not for a shared deployment.
3. **One company per installation.**
   - `fin.tenants` and `fin.companies` (built in P1, ADR-0084) each hold one row. The keys with `company_id` stay as built.
   - No isolation work is planned: no `finRead`, no scope setting, no isolation tests.
   - The rights per company mirrored in P1 stay as built; they equal today's roles.
4. **Cancelled, not deferred:**
   - the HTTP intake and the asynchronous transport (A1, A2);
   - publishing `@tugeel/fin-contract` and `mn` as versioned packages;
   - the TESTPMS fixture and source system `TEST_PMS`;
   - intercompany parties;
   - consolidation;
   - the accountant's hotel question D12, which belongs to the resort project.
5. **Kept:**
   - the intake with source keys, as Bto's own entry point, synchronous and in-process (ADR-0071 #1–#8);
   - posting rules held as data (ADR-0072);
   - open items;
   - periods (ADR-0075 as amended by ADR-0083);
   - the Mongolian layer (ADR-0074 #1–#3), shared with the resort only by copy;
   - the lean go-live plan F1–F6 (ADR-0083).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One shared core at run time (ADR-0069 … ADR-0077) | Not what the owner wants. It adds HTTP, outbox, isolation and intercompany work that a single company never needs. |
| A shared code package that both systems install | The owner chose a copy. A package needs versioning and release work, and changes in one system would reach the other. |
| Drop the finance-core boundary inside Bto | The boundary makes the copy cheap, and it costs nothing now that P0b and P1 are built. |

## Consequences

**Positive.**
- Bto's finance work shrinks further: nothing is built for a second system.
- Each system can change its finance module without affecting the other.

**Negative.**
- A fix made in one copy must be carried to the other by hand.
- The two systems' books are never combined automatically. A group view would be a report built later.

**Follow-ups.**
- `docs/modules/finance-core.md`, SPEC §2, §9.3 and §11, architecture and STATUS follow this ADR.
- The PMS rows leave ADR-0083's list.

## Related

ADR-0069 … ADR-0077, ADR-0083, ADR-0084, `docs/modules/finance-core.md`.
