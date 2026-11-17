# ADR-0212: A scan bridge on the office PC, so a USB scanner answers «Падаан scan хийх»

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: the scanner is an HP LaserJet Pro MFP M125a, «USB-ээр», «Оффисын PC-дээ үлдэнэ»; to «Оффисын PC-д суулгах scan-ы туслах програмыг одоо хийх үү?»: «Тийм, хий»), Claude |
| Amends | ADR-0210 #10 (a scanner the server cannot reach is reached through a program on its PC) and its rejected alternative «scanning through a helper on each PC» |

## Context

ADR-0210 lets the api ask a network scanner for a sheet over eSCL. The owner's scanner has no network port: it hangs by USB on an office Windows PC and stays there (the owner chose that over moving it to the server PC, where `ipp-usb` would have offered it, and it cannot join the network). So the button built for the owner's wish, «Падаан scanner хийх дарахад шууд Printer scanner ажилдаг», had nothing to press against, and a note was scanned with HP's program to a file and added by hand.

ADR-0210 rejected «scanning from the browser through a helper on each PC»: a program on every PC, kept alive, called by the page. That stays rejected. What is decided here is narrower: one program, on the one PC that has the scanner, called by the server.

## Decision

1. **`tools/scan-bridge`: a PowerShell program on the scanner's PC that answers eSCL.** `scan-bridge.ps1` listens on port 8765 (`HttpListener`) and answers exactly what Bto's `EsclClient` asks: `ScannerCapabilities` (the scanner's name, a glass, no feeder), `ScannerStatus`, `POST /eSCL/ScanJobs` (201 with the job's address), `GET …/NextDocument` (scans now and sends the JPEG; 404 the second time) and `DELETE`. To Bto it is one more scanner: a row of `note_scanners` with the PC's address, no change to the api, the rules of ADR-0210 #11 unchanged (a private IPv4 address, the job's path only).

2. **It scans through WIA**, Windows' own scanner interface, so it needs the scanner's ordinary driver and nothing else: no vendor SDK, no TWAIN, nothing compiled, nothing installed besides the script. One sheet from the glass, colour, 200 dpi, the whole bed, converted to JPEG when the driver hands over a bitmap. A feeder is not driven (409); the owner's device has none.

3. **It runs as the signed-in user, started by a scheduled task at their sign-in.** WIA reaches a USB scanner only from a user's session, so it cannot be a Windows service. The PC must be on and that person signed in for a scan; otherwise Bto says the scanner cannot be reached and a file can still be added.

4. **Only the server may ask.** The bridge answers the PC itself and the addresses of `-AllowFrom` (the server, `192.168.1.250`) and refuses everyone else (403); the firewall rule the installer adds lets only that address reach the port. Plain HTTP inside the building, no sign-in: the bridge can do one thing, scan what lies on the glass, and gives it only to the server.

5. **Installed by one line, removed by one line.** `install.ps1`, run in an administrator PowerShell (`irm …/install.ps1 | iex` from the public repository, or from a copy of the folder), copies the script to `C:\ProgramData\BtoScan`, reserves the port for the signed-in user, adds the firewall rule, registers and starts the task, asks the bridge what scanner it sees and prints the address to type into Bto. Every step can be repeated. `uninstall.ps1` undoes it. The scripts are plain ASCII (Windows PowerShell 5.1 reads a script without a BOM as ANSI); the owner's steps in Mongolian are `tools/scan-bridge/README.mn.md`.

## Alternatives considered

- **Moving the scanner to the server PC** (`ipp-usb` is installed there and would expose it over eSCL). Nothing to write; the owner keeps the scanner where the people who scan sit.
- **A scan program on the PC that saves into a watched folder.** The person would start the scan at the scanner's PC and then find the file in Bto: two places, and no «Хуудас нэмэх» from the page.
- **NAPS2 or the vendor's software with a network share.** A third-party install and its own settings on the PC; a hundred lines of script do the one thing needed.
- **A Windows service.** A service's session cannot reach a USB scanner through WIA.
- **A compiled helper (.NET, Go).** A build, a binary to sign and keep; PowerShell and WIA are on every Windows PC already.

## Consequences

**Positive.** «Падаан scan хийх» and «Хуудас нэмэх» work with the scanner the office has, from any PC or tablet Bto runs on; nothing changed in the api.

**Negative.** A program on an office PC that somebody must install once with administrator rights, and that works only while that PC is on with its user signed in; the PC needs a fixed address. One sheet a press. **Not tried on Windows**: the exchange was tried end to end on this PC with a test picture in place of the scan (Bto's own client, and the development api's scan route); the WIA scan, the port reservation, the firewall rule and the task are first run when the owner installs it.

**Follow-ups.** What the owner sees on the first install (the M125a's WIA driver, the time a sheet takes); a feeder if the office gets a device with one.

## Related

ADR-0210; `tools/scan-bridge/README.md`, `tools/scan-bridge/README.mn.md`; `docs/architecture.md` §9.7.
