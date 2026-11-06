# ADR-0163: Every role's rights are edited on «Дүрүүд», system roles too; a staff member's rights held and missing

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner (the request of 2026-11-06: «roles бүрийн тохиргоог засах өөрчлөх боломжтой болго. Системийн дүрийг ч бас. Мөн ажилтнаар filter хийж ямар эрхтэй байгаа, ямар эрхгүй байгааг харах боломжтой болго»), Claude (Claude Code session) |
| Amends | ADR-0027 #4 (a system role's permissions are no longer exactly the code's), ADR-0027 #5 (system roles are no longer read-only) |
| Migration | `0080_role_permission_overrides` |

## Context

ADR-0027 kept system roles read-only: the code held their permission sets and every boot rewrote `role_permissions` from it. An edit in the database would have been lost at the next restart. The owner registers real staff under these roles (35 of them were given a role from their job title on 2026-11-06) and wants to decide what each role may do, without a code change. The owner also wants to pick a person and see what they may and may not do, since a person's rights are the sum of their roles.

The concern, stated and accepted: this gives up the guarantee that a system role means the same on every installation, and a wrong untick takes a right from everyone holding the role at once. The audit row and the way back to the code's set answer that.

## Decision

1. **Every role opens in the same dialog** for a holder of `identity.roles.manage`. A system role keeps its code and label (the staff form's hint and the staff app name it by code), and cannot be deleted (`ROLE_SYSTEM_READONLY` now means only that). Changing its name is refused: 422 `name` `systemRole`.
2. **An admin's ticks are stored as differences from the code**, in `role_permission_overrides` (`role_id`, `permission_code`, `granted`). A system role's rights are the code's set, plus what was ticked, minus what was unticked (`systemRolePermissions`), and `syncAccessCatalog` rebuilds its `role_permissions` from that at every boot. `role_permissions` stays what the guard reads, so a change acts on the holder's next request. A right a later version adds to the code therefore still reaches an edited role, unless the admin unticked that very right. Ticking the code's set again leaves no difference: the role is no longer «Өөрчилсөн». «Анхны эрх рүү буцаах» does that in the dialog.
3. **ADMIN keeps what keeps the screen reachable.** `ADMIN_LOCKED_PERMISSIONS` (`identity.users.read`, `identity.users.manage`, `identity.roles.manage`): the dialog shows them ticked and locked, the api refuses their removal (422 `permissions` `adminLocked`) and the boot sync adds them back. Any other right of ADMIN may be taken away, and stays away across boots.
4. **The admin-only codes stay with ADMIN** (ADR-0027 #5 holds): no other role, system or custom, may be given `identity.users.manage` or `identity.roles.manage` (422 `isAssignable`), so managing users and roles still needs the ADMIN role.
5. **«Ажилтан» on `/roles`** (`?user=`): a pick-one filter of all staff, typed by name or phone. The list narrows to that person's roles, and a card below lists every right of the catalog per module, ticked or crossed, with the roles granting it; the view `?show=` is Бүгд / Эрхтэй / Эрхгүй. Computed in the browser from `GET /roles` and `GET /users`, the same rows the guard uses. Write scopes are not part of it: they limit where a right applies (ADR-0027 #7), and stay on the staff member's page.
6. **The dialog groups the rights by module** (`roles.groups.*`, `permissionGroup`), as the list had grown past seventy.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Stop the boot sync for a role once it is edited (a flag) | A right a later version adds would silently never reach that role, and the feature would look broken for its holders. |
| Tell the owner to build custom roles instead | The owner asked for the system roles too, and staff already hold them. |
| Let ADMIN lose everything | One wrong save would leave nobody able to open the screen; repairing it would take the database. |
| Renaming system roles | Their labels come from the code in the staff form's hint, the HR lists and the staff app; a second source of names for little gain. A custom role carries any name. |
| A server route for a person's rights | `AuthContext` already resolves them for the signed-in person; for the screen the two lists hold all it needs. |

## Consequences

**Positive.** The owner decides what a role may do, on screen, at once, with an audit row of before and after. New rights in later versions still arrive.

**Negative.** A delivery's assumption «this system role holds this right» may no longer hold on the installation; screens still answer 403 as usual. `SYSTEM_ROLE_PERMISSIONS` is now where a role starts, not what it is.

**Follow-ups.** ADR-0162's data-group switches are for custom roles because system roles were read-only; once both are on main, the assistant's groups can be ticked here for any role.

## Related

ADR-0027, ADR-0084 #2 (`user_company_roles` holds role ids, so finance rights follow the same edits), ADR-0162, `docs/modules/identity.md`.
