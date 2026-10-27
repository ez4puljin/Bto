# Runbook: a till's receipt printer and the store PosAPI (POS S3, ADR-0065)

The kiosk prints each receipt with Chrome's own printing on the till's Windows PC, through the 80 mm printer's Windows driver. The e-Barimt comes from the store PosAPI on the LAN, called by the store edge.

## Each till PC (Windows)

1. Install the 80 mm receipt printer's Windows driver as the vendor ships it. In the driver's printing preferences pick the 80 mm (72 mm printable) roll paper and the receipt's full length, and set **no margins**. The kiosk sets `@page { margin: 0 }`; the width comes from the driver.
2. Make that printer the Windows **default printer** (Settings → Bluetooth & devices → Printers & scanners; switch off «Let Windows manage my default printer»).
3. Make a shortcut that opens the till in Chrome and prints without the dialog:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://<store PC's LAN address>:7400
   ```

   A till is paired per address: `http://localhost:7400` and `http://<LAN address>:7400` are two different devices to the browser, so keep the shortcut's address (a new address asks for a fresh pairing code from «Супермаркет → Касс»). `--kiosk-printing` sends `window.print()` straight to the default printer. Chrome must be fully closed (also from the tray) before the shortcut is used, or the flag is ignored. `--kiosk` (full screen) may be added once the till is set up.
4. Without the flag, Chrome's print dialog opens on every receipt: pick the 80 mm printer, «Margins: None», and print. This is the fallback when the default printer is another one.
5. Test: sell with the fake provider (the receipt says «ТУРШИЛТЫН БАРИМТ»), check that the Mongolian letters (Ө, Ү) and the QR code print sharp. The cash drawer is opened with its key; nothing is sent to it.

## The edge and the store PosAPI

- `deploy/edge/.env` (from `.env.example`): `EBARIMT_PROVIDER=posapi`, `POSAPI_URL=http://<PosAPI PC>:7080`, `EBARIMT_BRANCH_NO=<the branch number the old till sends, e.g. 01>` (PosAPI refuses a receipt without it); `EBARIMT_LOOKUP_URL` stays `https://api.ebarimt.mn` (the company lookup; works only from Mongolian addresses). Then `pnpm edge:down` and `pnpm edge:up`.
- Every receipt sent to a real PosAPI is registered with the tax office. Never point a test or a development edge at a real PosAPI without the owner's yes for each sale; returns cancel or replace receipts for real too.
- Never change `posapi.ini`, restart PosService or install anything on the PosAPI PC from Bto's side; the PosAPI's operator (the vendor) activates a new PosAPI.
- Check: `GET http://<PosAPI PC>:7080/rest/info` answers the version, `lastSentDate` and `leftLotteries` (read-only). The admin's «Супермаркет → Касс» shows the same facts from the edge's heartbeat, and the till's menu «e-Баримт» too.
- S5: when PosAPI moves to the Ubuntu PC that runs the edge, change `POSAPI_URL` only.

## When a receipt waits

- **PosAPI away** (the PC off, PosService stopped, the network cut): sales go on; the slip says «e-Баримт хүлээгдэж байна»; the edge sends the receipts itself when PosAPI answers again, and the till's «e-Баримт → Хэвлэхэд бэлэн» prints each once with its lottery and QR (until that till's shift closes).
- **The internet away, PosAPI up**: citizens' receipts print normally (PosAPI works offline with the lotteries it holds and sends within 3 days); company receipts are not possible until the lookup answers.
- **«Шалгах»** (sent, no answer): look the receipt up on ebarimt.mn by the time and amount. Found: «Гарсан» with its ДДТД and date. Not found: «Гараагүй, дахин илгээх». Both take a supervisor's PIN.
- **«Алдаатай»**: PosAPI refused (its message shows). The edge tries again for a day; fix the cause (district or classification code in «Супермаркет → Тохиргоо», lotteries, the 3-day sending window) and press «Дахин илгээх».
- **«Татвар руу илгээх»** asks PosAPI to send its stored receipts now; the tills' menu shows the last send and the lotteries left, with a warning after a day.
