# Bto print bridge

Price labels («үнийн шошго») are drawn by the Bto server as ESC/POS bytes for an 80 mm thermal
receipt printer (ADR-0226). A printer with its own network port gets them from the server on port
9100; a printer attached to a Windows PC by USB (or shared by Windows) needs this small PowerShell
program on that PC. It asks the server for its print station's next job with the station's key and
writes the bytes RAW to the chosen Windows printer through the winspool API (no driver rendering).
It only calls out: no port is opened on the PC. The owner's steps in Mongolian:
[README.mn.md](README.mn.md).

| File | What it is |
|---|---|
| `print-bridge.ps1` | the bridge: a loop of `GET /api/v1/print-bridge/next` (a long poll of ~25 s) and `POST /api/v1/print-bridge/jobs/<id>/done`, with `Authorization: Bearer bps_<station>_<secret>` and `X-Printer-Name` |
| `install.ps1` | asks for the printer, copies the bridge to `C:\ProgramData\BtoPrint` with `config.json` (server, key, printer; the folder readable only by the user and the administrators), registers the task «Bto print bridge» (at that user's sign-in) and starts it |
| `uninstall.ps1` | removes the task and the folder |

## Install

In Bto, «Систем → Принтер → Принтер нэмэх», kind «Компьютерт залгасан». The page shows the key once,
inside the whole install line. On the PC, Windows 10 or later, in a PowerShell window opened with
«Run as administrator», paste that line:

```powershell
[Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/print-bridge/install.ps1))) -Server 'http://192.168.1.250' -Key 'bps_1_…'
```

It lists Windows' printers and asks for the number of the label printer (or takes `-Printer '<name>'`).
A lost key: «Шинэ түлхүүр» on the printer's row gives a new one (the old one stops) and a new line.

## What it does with a job

| Step | |
|---|---|
| `next` answers `{ job: null }` | asks again at once |
| `next` answers a job | decodes `data` (base64) and writes it RAW to the printer; reports `{ ok: true }`, or `{ ok: false, message }` with Windows' error |
| 401 | the key was refused (the printer disabled or given a new key): logs it, tries again a minute later |
| no answer | logs it once, tries again every 5 seconds |

The log is `C:\ProgramData\BtoPrint\bridge.log` (started again past 1 MB). The server marks the
station online while the bridge calls (within a minute), and fails a job nobody took in two minutes
with «Принтер холбогдоогүй байна».
