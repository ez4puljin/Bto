# Carrying «Хугацааны хяналт» over from the old system

`carry.mjs` brings the old `/expiration` page's records and their quantity history into Bto's register (`/inventory/expiry`, ADR-0172 #12). It talks to Bto only over HTTP, through `POST /expiry/items/carry`, so the audit rows are real and it never opens the database. `docs/modules/expiry.md` §5 is the route's contract. `rules.mjs` holds the conversion and `rules.test.mjs` proves it on made-up rows.

**When to run it:** after migration `0090_expiry`, and once more at the cut-over, since two systems accept records until the old page stops.

## The dump

The tool reads four files in the gitignored `tmp/expiry-old/`. They hold real names and records and never enter this repository, which is public.

| File | Holds | Old route |
|---|---|---|
| `items.json` | The array of old records, archived ones too | `GET /expiration/items?include_archived=true` |
| `history.json` | An object from old record id to its history array | `GET /expiration/items/{id}/history`, once per record |
| `roles.json` | The old roles, for their labels | `GET /expiration/lookup/roles` |
| `users.json` | The old staff, for their names | `GET /expiration/lookup/users` |

The old system has its own sign-in, so the dump is taken from the signed-in old page in the browser and posted to a small receiver on this PC. Only `GET` routes of the old system are called. The sign-in token stays in the page and is never sent to the receiver.

**1. Start a receiver.** Keep it in a scratch folder, not in the repository. Bound to `127.0.0.1`, it accepts only the old site's origin, stores each body under `tmp/expiry-old/`, and stops by itself after 30 minutes. Run it from the repository root, with the old site's origin as its argument:

```js
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = process.argv[2];
const OUT = join(process.cwd(), 'tmp/expiry-old');
mkdirSync(OUT, { recursive: true });
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};
createServer((req, res) => {
  if (req.headers.origin !== ORIGIN) return res.writeHead(403).end();
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const name = new URL(req.url, 'http://x').searchParams.get('name').replace(/[^\w.-]/g, '');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    writeFileSync(join(OUT, name), Buffer.concat(chunks));
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
}).listen(18765, '127.0.0.1');
setTimeout(() => process.exit(0), 30 * 60 * 1000);
```

**2. Run this in the signed-in old page's console.** The old site serves its API on its own origin. Check the first route answers before trusting the rest. Do not add a `targetAddressSpace` option to the fetch: it makes the fetch fail.

```js
const headers = { Authorization: 'Bearer ' + localStorage.getItem('token') };
const get = async (path) => {
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(path + ' ' + res.status);
  return res.json();
};
const send = (name, data) =>
  fetch('http://127.0.0.1:18765/?name=' + name, { method: 'POST', body: JSON.stringify(data) });
const items = await get('/expiration/items?include_archived=true');
const history = {};
for (const item of items) history[item.id] = await get('/expiration/items/' + item.id + '/history');
await send('items.json', items);
await send('history.json', history);
await send('roles.json', await get('/expiration/lookup/roles'));
await send('users.json', await get('/expiration/lookup/users'));
```

A dump is a picture of one moment. Take a new one before each run.

## How to run it

From the checkout that holds `tmp/` (a worktree has none), with the API running:

```bash
node tools/expiry-carry/carry.mjs
```

That signs in and looks up every product, posts nothing, and prints how many rows it would send.

```bash
node tools/expiry-carry/carry.mjs --write
```

That posts each record, one at a time, with a fresh `Idempotency-Key`.

| Option | Default |
|---|---|
| `--old <folder>` | `tmp/expiry-old` |
| `--api <url>` | `http://127.0.0.1:3300/api/v1`, the development server and so `bto_main` |
| `--login <name>` | `import`. It needs the right `expiry.items.carry`, ADMIN only by default, or every post answers 403 |
| `--logins <file>` | `tmp/dev-logins.txt` |

`CARRY_PASSWORD` overrides the logins file. The tool signs in again when its 15-minute token runs out and never prints a password or a token.

**What it prints:** a progress line every 100 rows and a summary of counts: rows read, `CREATED`, `UPDATED`, `UNCHANGED`, `KEPT`, products not found, rows left out and why, liability rows, truncated notes. It prints no names, product names, quantities or notes, so its output can be pasted. A failed row is the one exception to counts: up to 20 lines name the old record's id, the HTTP status, the problem's code and the refused fields, and never a value. It goes on past a failed row and exits with code 1 if any failed.

## Running it again

Running it again is safe, and that is the plan. The route is idempotent on the old record's id, which is why each post can have its own key:

| Answer | Meaning |
|---|---|
| `CREATED` | A record new to Bto |
| `UPDATED` | The old record changed and nobody has touched it in Bto, so the old values replace it |
| `UNCHANGED` | Nothing differs |
| `KEPT` | Someone touched the record in Bto, so it stays as they left it |

**A Bto-touched row** is one with `updated_by` set: someone corrected its date, quantities or note, or decided its status or liability, in Bto. From then on Bto's version wins and later runs never overwrite it, even if the old page changes it too. Old history rows not yet present are still appended to every record, touched or not, by the old change's id, and nothing already in the history changes.

## What it does to old rows

- **Words:** `review`, `city_return`, `internal_sale`, `archived` become `REVIEW`, `CITY_RETURN`, `INTERNAL_SALE`, `ARCHIVED`; `none`, `specific`, `all_staff` become `NONE`, `SPECIFIC`, `ALL_STAFF`.
- **Times:** the old system's naive UTC text gets its `Z`.
- **Quantities:** old floats become strings with at most three decimals. A negative or unreadable one leaves the record out, and a history row with one is dropped and counted while its record still comes over.
- **Authors:** kept as text, never turned into a Bto user. An empty author becomes «Хуучин систем».
- **Liability:** old roles and people have no sure Bto match, so no ids are sent. On a `specific` row their labels and names are appended to the liability note as «Хуучин: …», as the old page showed them. The old lookups leave out admin and inactive staff, so such a role shows its slug and such a person `#id`.
- **Long text:** a note over 1000 characters or a liability note over 500 is truncated and counted.

**Finding the product:** the old code, with a trailing `.0` stripped, as a SKU through `GET /products/lookup`; then the old code through `GET /barcodes/:code`; then each comma-separated old barcode. Each code is asked once a run. An ambiguous barcode (409) counts as not found. `lookup` answers active products only, so an inactive product with no current barcode counts as not found although the register could hold it. A row whose product is not found is not sent; a later run picks it up if the product appears.
