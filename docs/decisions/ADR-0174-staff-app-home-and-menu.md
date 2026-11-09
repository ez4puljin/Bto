# ADR-0174: The staff app opens on «Нүүр» and lists its screens on «Цэс»; a rep's order tabs are «ХТ захиалга»

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Owner («Staff апп дээр ажилтан нэвтрэх үед Нүүр цэсэнд Лого, Нэр, Ажилтаны нэр, Өнөөдрийн ирц дарсан эсэх, өнөөдрийн үйл явдлын мэдээлэл, Өөрийн favorite цэсний жагсаалт харагддаг байна»; «Цэс гэдэг цэсэнд … ХТ болон Хт захиалга цэс харагдаж түүн рүү ороход Одоогийн захиалгын цэс харагддаг байх, мөн бусад … эрхийн цэснүүд бүгд харагддаг байхаар хий»), 2026-11-07 |
| Amends | ADR-0166 #6 (`selfUpdate` was only the customer variant), ADR-0068 and ADR-0100 (a rep landing on the shop's home), ADR-0116 #1, ADR-0131 and ADR-0132 (each person landing on their own work tab) |

## Decision

1. **Everyone lands on the same two tabs.** `(staff)/(work)` holds only «Нүүр» (`/`) and «Цэс» (`/menu`), first in the stack. No right changes where a person lands.
2. **«Нүүр»** shows the company's logo and name, the signed-in person and their role, whether today's attendance is punched (a tap opens «Ирц», which punches), today's events from the HR calendar, and the person's favourite menu rows. The bell opens a rep's notifications, or «Хамт олон» for everyone else.
3. **Favourites are per person, per phone.** They are kept in the phone's storage under `userKey('favourites', server, userId)`, with no server table and no migration. A new phone starts over. Before any choice a person sees their work rows and «Хамт олон». A row the person may no longer open is dropped.
4. **«Цэс»** lists every screen the app has, in groups, by the same rights the screens are guarded with (`src/staff/menu.ts`). A star on a row adds or removes it from the favourites. A screen that exists only on the web is not listed, whatever rights the person holds: the app has nothing to open.
5. **«ХТ захиалга» is the rep's order tabs unchanged.** `(staff)/(tabs)` keeps «Нүүр», «Бараа», the scanner, «Сагс» and «Захиалга»; its first tab moves from `/` to `/rep`, and its header's wordmark gives way to the arrow back.
6. **The work screens are pages now.** «Ирц», «Бэлтгэл», «Шилжүүлэг» and the plain «Профайл» leave the tabs and open over them with a back arrow. Their paths (`/attendance`, `/picking`, `/transfers`, `/me`) stay.

7. **The staff app updates itself** (owner: «апп дээрээс шууд шинэчлэл татах боломжтой болго»), on the mechanism of ADR-0166: `selfUpdate` in `variants.json`, `GET /app-releases/staff`, `pnpm mobile:publish`, and the same card at the top of «Нүүр», where every staff member lands. The first install of 0.13.0 is by hand: an older APK has no updater.
8. **The staff app's sign-in shows the company** (owner: «Ажилтны апп хэсэгт байгууллага лого, Ажилтны апп гэсэн нэр байх ёстой. Та системээс гарлаа гэдэг msg нэвтрэх товчны доор харагддаг болго»). The sign-in, server and offline screens carry the company's logo (ADR-0166) and the name «Ажилтны апп» instead of the «B» tile and «Bto». Why the last session ended («Та системээс гарлаа», or the expiry) shows under the sign-in button. The launcher's name stays «Bto».
9. **«Нууц үг сануулах» and the fingerprint** (owner: «нууц үг сануулах болон гар утасны хурууны хээгээр шууд нэвтрэх боломжтой болго»).
   - A switch under the fields, on by default, keeps the login and password after a successful sign-in, in the phone's secure storage (`expo-secure-store`, Android Keystore). They are kept for one server, one person at a time, in `src/device/saved-login.ts`. Turned off, the next sign-in forgets them.
   - On a phone with an enrolled fingerprint (`expo-local-authentication`), the kept password is never filled in. The fingerprint unlocks it and signs in, and Android offers the phone's PIN or pattern instead. The screen asks at once, unless the person just signed out; «Хурууны хээгээр нэвтрэх» asks again. On a phone without one, the kept password is filled in.
   - The server checks the password as on any sign-in. When it refuses a kept password (`INVALID_CREDENTIALS`, the password changed), the phone forgets it.
   - «Гарах» does not forget it, which is what makes the next sign-in one touch. The person turns the switch off on a phone they share.
10. **«Шинэчлэл шалгах» and a fuller «Нүүр»** (owner 2026-11-09: «ажилтны апп update шалгах товч нэмье. Түүн дээр дарахад шинэ version гарсан бол дотоод сүлжээгээр өөрийгөө шууд шинэчилдэг болго. Нүүр цэсийг улам сайжруул»).
   - The bottom of «Нүүр» and both profiles show the app's name and version with «Шинэчлэл шалгах». A press asks the server at once instead of waiting for the two-minute poll of #7. A newer release starts downloading from the server over the shop's own network, with its progress, and opens Android's installer. Otherwise the press says the newest is installed, or that the server did not answer.
   - Android asks once to allow installs from this app, and confirms every install of an APK from outside a store. That one tap stays: an app installs silently only as a device owner, and a phone of the shop is not one.
   - «Нүүр» greets the person by first name with today's date, and its attendance card shows the work time, the worked hours that grow while the person is in, and a «Ирц бүртгэх» button on a workday before the first punch. «Шинэ мэдээлэл» lists the menu rows with an unread count. The favourites sit on one card that ends with a tile opening «Цэс».

## Consequences

- A keeper or a seller is one tap further from their work than before: their row is a favourite from the first sign-in.
- The rep's shop window stays where it was, one level down, and ThumbKeeper and the notice popup still run from sign-in.
- Favourites do not follow a person to another phone. If that is wanted later, they move to a server table without changing the screens.
- «Нүүр» shows initials, not a photo: the signed-in user's own data has no photo today.
- A kept password sits on the phone. It is encrypted by the phone's keystore, but anyone who can unlock that phone can sign in as its owner. The rule against storing passwords is the server's (argon2 hashes, ADR-0027) and is unchanged.
- A new native module (`expo-local-authentication` 57.0.3, the SDK 57 pin) needs a new APK: the update in #7 brings it.
- A release reaches the phones only once it is published on the server (`pnpm mobile:publish`); until then «Шинэчлэл шалгах» says the newest is installed.
