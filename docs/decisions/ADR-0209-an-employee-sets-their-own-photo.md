# ADR-0209: An employee sets their own photo from the staff app

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Ажилтны апп ашиглан өөрийн Profile зургаа солих боломжтой болго»), Claude |
| Amends | ADR-0144 #1 (the card's photo was HR's alone) |

## Context

Since ADR-0144 an employee's photo (`hr.employee_photo`, public, ≤ 1 MB, square) is set on the card only by HR on «Хүний нөөц → Ажилтан» (`PUT /hr/staff/:userId/photo`, `hr.attendance.manage`), and only holders of that permission may request an upload of the kind. The staff app shows the photo (home, «Профайл», «Хэрэглэгчийн мэдээлэл», «Хамт олон») since 0.22.1, but most of the 40 employees came from timely without one, and the owner wants each employee to put up their own.

## Decision

1. **`PUT /hr/me/photo`** (`@Authenticated`, body `{ fileId }`) puts a photo on the caller's own card, through the same `attachPhoto` as HR's: the card's previous photo file is deleted, the change is audited with the employee as actor. The file must be an uploaded `hr.employee_photo` whose `owner_id` is the caller (`FORBIDDEN`, reason `OWNER`, otherwise): nobody puts someone else's upload on their card. It answers the employee's profile (`HrProfile`), as `GET /hr/me/profile` does.
2. **Any signed-in staff member may request an upload of `hr.employee_photo`**: a file kind may say `anyStaff: true` (`packages/shared/src/files`), and `StorageService.createPending` lets every staff token through for it. This is the only such kind; every other kind still needs one of its permissions. An upload nobody attaches is removed by housekeeping like any other.
3. **The staff app** («Хэрэглэгчийн мэдээлэл»: a tap on the photo, or «Зураг солих») asks «Зураг авах» (the front camera) or «Утасны зургаас сонгох»; the phone's cropper cuts it square, the app cuts the middle square anyway and makes a JPEG of at most 512 px (`expo-image-picker` 57.0.20, `expo-image-manipulator` 57.0.21, without the microphone permission), uploads it and calls the route. HR's route and screen are unchanged and can still replace or remove it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A second kind (`hr.own_photo`) for the employee's upload | Two kinds for one photo: HR's screen, the till's cashier photos and the card would have to accept both. |
| Send the bytes to `PUT /hr/me/photo` itself, resized by the server | A second upload path beside the signed one every other picture uses. |
| HR approves a photo before it shows | Not asked for; HR can still replace one. |

## Consequences

- Every employee can change their photo from the staff app; HR sees it on «Ажилтан» and the till's sign-in screen at once.
- Any staff member can upload public images of up to 1 MB of this kind; unattached ones are swept.
- The app needs a new APK (two new native modules); the web copy (`pnpm mobile:web`) has it at once.

## Related

ADR-0144, ADR-0014, ADR-0029, ADR-0146, `docs/modules/hr.md`, `docs/modules/mobile.md`.
