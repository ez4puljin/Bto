# Bto scan bridge

A scanner plugged into an office PC by USB cannot be reached by the Bto server (ADR-0210 #10 asks a
network scanner over eSCL). This small PowerShell program runs on that Windows PC and answers the
part of eSCL that Bto's client speaks (`apps/api/src/integrations/scanner`), scanning through
Windows' own WIA, so «Падаан scan хийх» works for a USB scanner too (ADR-0212). The owner's steps in
Mongolian: [README.mn.md](README.mn.md).

| File | What it is |
|---|---|
| `scan-bridge.ps1` | the bridge: an `HttpListener` on port 8765 and a WIA scan of one sheet from the glass (colour, 200 dpi, JPEG) |
| `install.ps1` | copies it to `C:\ProgramData\BtoScan`, reserves the port for the signed-in user, opens the firewall for the server's address only, registers the task «Bto scan bridge» (at that user's sign-in) and starts it |
| `uninstall.ps1` | removes all of that |

## Install

On the office PC, Windows 10 or later, in a PowerShell window opened with «Run as administrator»:

```powershell
irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/install.ps1 | iex
```

It ends with the scanner Windows sees and the address to type into Bto («Орлого → Падаан унших →
Scanner тохируулах»), `http://<the PC's address>:8765`. Another server address or port: download the
folder and run `powershell -ExecutionPolicy Bypass -File install.ps1 -Server 192.168.1.250 -Port 8765`.

## What it answers

| Request | Answer |
|---|---|
| `GET /` | `Bto scan bridge: <scanner name>` (a look from the PC's own browser) |
| `GET /eSCL/ScannerCapabilities` | the WIA scanner's name as `MakeAndModel`, a `Platen`, no `Adf` |
| `GET /eSCL/ScannerStatus` | `Idle` |
| `POST /eSCL/ScanJobs` | 201 with `Location: …/eSCL/ScanJobs/<id>`; 409 for the feeder (glass only); 500 when Windows shows no scanner |
| `GET /eSCL/ScanJobs/<id>/NextDocument` | scans now and answers the JPEG; 404 for the second call (one sheet a job) and for an unknown job; 500 when the scan failed |
| `DELETE /eSCL/ScanJobs/<id>` | 200 |

Everything else is 404. A caller that is neither the PC itself nor in `-AllowFrom` (the server,
`192.168.1.250` by default) gets 403; the firewall rule lets only that address in as well. The api's
containers reach the PC through Docker's NAT, so the PC sees the server's own address.

## Limits

- It runs in the signed-in user's session (WIA reaches a USB scanner only there): the PC must be on
  and that user signed in. The task starts it again at every sign-in.
- One sheet from the glass per press; a feeder is not driven.
- The PC needs a fixed address (a reservation on the router), since Bto keeps the address.
- Plain HTTP on the building's network, no sign-in: the allow-list and the firewall rule are the
  guard. Do not open the port to anything else.
- Its log is `C:\ProgramData\BtoScan\bridge.log` (what was scanned, why a scan failed, who was
  refused); it restarts once it passes a megabyte.

## Trying it without a scanner

`-FakeImage <file.jpg>` answers with that file instead of scanning and needs no WIA, so the exchange
can be tried anywhere PowerShell runs (it was, on Linux, against Bto's own client and through the
development api's «scan» route). The WIA scan, the port reservation, the firewall rule and the task
can only be tried on a Windows PC with the scanner.
