# ADR-0145: One staff list — a system user and an employee are one record, sign-in by phone and a password reset directly

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («http://localhost:5173/hr/staff болон http://localhost:5173/users нэг байх ёстой. Системийн хэрэглэгч болон ажилтан 2 нэг зүйл шүү. User идэвхгүй нь … ажлаас гарсан ажилтан жагсаалтанд орох ёстой. Нэгтгэ»; «Ажилтан системд нэвтрэхдээ утасны дугаар / нууц үг ашиглана. Системийн нууц үг шууд reset хийх боломжтой байна», 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0144 #1 and #6 (roles given on «Систем → Ажилтан», the card in a dialog), ADR-0128 #6 (the staff list by role, the one-time code on registering), the owner's 2026-10-29 placing of the staff under «Харилцагч» |

## Context

ADR-0144 added «Хүний нөөц → Ажилтан» beside the older staff accounts page `/users`. Both listed the same `users` rows, with different columns and rights, and a disabled user stayed «Идэвхгүй» among those still working. The owner wants one list. HR's page also reached the account (password, phone, leaving) with no check on who holds the account, which the merge would have put in front of everybody with `hr.attendance.manage`.

## Decision

1. **One list and one page.** `/hr/staff` is the staff list (photo, division, phone, roles, schedule, last sign-in, status; filters by division and role, a search, «Ажлаас гарсан ажилтнууд»). A row opens `/hr/staff/:id`: the card, the roles and write scopes, the signed-in devices. `/users` and `/users/:id` only redirect there, and the menu entry under «Харилцагч» is gone. `hr.attendance.view` opens both pages; on them the roles' card and the devices need `identity.users.read` and `identity.users.manage` as before. The `/users` API stays: the page reads and changes roles and scopes through it.
2. **A closed account is an employee gone.** `isEmployeeLeft` in `@tugeel/shared/hr`: `status = DISABLED` or a left date. So a user disabled by any path appears under «Ажлаас гарсан ажилтнууд», with no date when HR gave none; «Ажилд эргэж орсон» opens the account again. The status column has no «Идэвхгүй».
3. **Sign-in is the phone and a password; the password is reset directly.** `PUT /hr/staff/:userId/password` sets a new one (the strength rule as everywhere), clears the lock-out and ends the account's sessions except the caller's own. It is read out to the employee, so the field is shown in clear; it is sent once and never stored or echoed. The card no longer takes a password, and registering requires the first one. The one-time code stays only for `pnpm user:create-admin` and `/set-password`.
4. **One phone, one record.** Registering a phone already in the list is refused (`VALIDATION_FAILED` on `phone`); the import keeps matching by phone (ADR-0144 #7).
5. **What HR may not do to an account.** Whoever lacks `identity.users.manage`: gives a password only to an account with no roles, or HR could sign in as anybody with more rights; does not change an admin's name or phone and does not mark an admin as left (`FORBIDDEN`). The card's other fields stay HR's. Marking someone as left also refuses the last active ADMIN (`LAST_ADMIN`, the rule of ADR-0027 #6).

## Consequences

**Positive.** One place for a person; nothing is registered twice; a forgotten password is fixed on the spot without a code.

**Negative.** A role holding only `identity.users.read` no longer has a page (no such role exists on `bto_main`); an administrator who knows the new password can use it until the employee changes it, and the audit records only that it was reset. The seven test accounts without a phone still sign in by their old login name until a phone is written on their card (ADR-0128).

## Related

ADR-0027, ADR-0128, ADR-0144, docs/modules/hr.md, docs/modules/identity.md.
