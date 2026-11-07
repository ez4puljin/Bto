# Carrying «Ebarimt» over from the old system

`carry.mjs` brings what the old system's e-Barimt page holds into Bto's `/finance/ebarimt` through Bto's own API, so the audit and the history are real.

**When to run it:** once more at cut-over, if the old page keeps being used until then. `bto_main` already holds the eleven months 2025/12–2026/10.

**What it carries,** for the suppliers Bto has, Orgil's side only:

- each month's e-Barimt file;
- registers, phones and remarks, from the latest month;
- each month's exempt amounts, notes and receipt links;
- each month's employee, by a map you keep yourself.

**What it reads,** all in the gitignored `tmp/ebarimt-old/` and never in this repository, which is public:

| File | Holds |
|---|---|
| `report-YYYYMM.json` | The old page's report of the month |
| `slots-YYYYMM.json` | The month's file slots, for the file's name |
| `ebarimt-YYYYMM.xlsx` | The month's e-Barimt export |
| `employees.json` | `{ "<name on the old page>": <Bto user id> }`. Without it, employees are skipped |

**How to run it,** from the repository root, with the API running:

```bash
node tools/ebarimt-carry/carry.mjs
```

That only reads, and prints how many values would change.

```bash
node tools/ebarimt-carry/carry.mjs --write
```

That writes them. This path has not written anything yet: when the tool was written, `bto_main` already held it all, so try it on a copy of the database first. Running it again writes nothing, because only what differs from Bto is written. An old value of nothing never clears what is in Bto, but an old value that differs replaces what people typed in Bto, so run it before people start working in Bto, not after.

It signs in as `import` with the password from `tmp/dev-logins.txt` (`--login` picks another name; `CARRY_PASSWORD` overrides the file) and takes `--api` for another server. It prints counts only, never names or amounts.
