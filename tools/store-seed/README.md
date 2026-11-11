# The store seed: master data into an empty database

`pnpm store:seed` copies **master data only** from one Bto database into another that was migrated and never started (ADR-0186 #6). It was built to start the centre on the store's Ubuntu PC from the real products, customers, staff, prices and chart of the dev database, without one test document. The code is `apps/api/src/db/store-seed/` (`manifest.ts`: every table and what happens to it; `seed.ts`: the plan and the copy; `cli.ts`); its proof is `apps/api/test/integration/store-seed.int-spec.ts`.

The install steps around it are in `docs/runbooks/store-install.md` §3. This page is the tool's own contract.

## What it does

- **Dry run by default.** Without `--apply` it only reads both databases and prints every table under «COPIED», «LEFT EMPTY» or «NOT DECIDED (left empty)» with the row counts, then any problem that would stop the copy.
- **Refuses a target that is not empty.** Every table of the target must be without rows, except the reference rows the migrations themselves write. A database the api has started (it writes the permissions at its first start) or anybody has worked in is refused, and nothing is written.
- **Both databases on the same migrations.** Migrate the source and the target from the same commit.
- **Reads the source in one read-only snapshot**, writes the target in **one transaction** as the role that owns the tables (`migrator`), by plain `INSERT`s in foreign-key order. No trigger is disabled and no constraint relaxed; the append-only guards of the target stay as the migrations made them. Any refusal rolls everything back.
- **A copied row points only at copied rows.** A foreign key from a copied table into a table that stays empty stops the plan, unless the manifest overwrites that column.
- **Counts before the commit.** Every copied table must hold exactly the planned rows and every other table what it held; the identity sequences are then set past the highest copied id.
- **Prints table names and counts only**: never a row, never a connection string.

What never travels: documents, stock, journals, audit history, sessions, one-time codes, the edge's token and link code, the tills' pairing codes, the cashiers' PINs, the sealed AI key. The full list is the dry run's output and ADR-0186 #7.

## Running it

From the repository root, on the PC that reaches both databases:

```bash
pnpm store:seed                 # dry run
pnpm store:seed --apply         # the copy
pnpm store:seed --apply --files-list ../../tmp/store-seed/files.txt   # and the list of files to carry
```

| Variable | Meaning |
|---|---|
| `SEED_TARGET_DATABASE_URL` | The empty, migrated database, as role `migrator`. Never defaulted: the tool does nothing without it. |
| `SEED_SOURCE_DATABASE_URL` | The database holding the master data. Default: `MIGRATOR_DATABASE_URL` of `apps/api/.env`, i.e. the dev database. It is only read. |

`--files-list <file>` writes the paths (below the storage folder: `public/<name>` or `private/<name>`) of the files whose rows were copied, so the files themselves can be carried into the target's storage. `--storage-dir <dir>` names the source's storage folder when it is not `STORAGE_LOCAL_DIR` of `apps/api/.env`. Paths are relative to `apps/api`, where the script runs.

Set the target URL in the shell's environment without typing its password into a command line or a file of this repository (the runbook reads it from the box over SSH into a variable). `tmp/` is gitignored: the files list stays there.

## Changing what moves

`manifest.ts` names every table once:

| Class | Meaning |
|---|---|
| `copy` | Master data. Options: `set` (columns that get a fixed value instead: tokens, codes, last-seen facts), `onlyReferenced` (only rows another copied table points at: the files), `seeded` (the migrations write rows here, so the copy merges by primary key), `late` (a nullable column written in a second step, for two tables that point at each other), `appendByContent` (an append-only table the migrations seed: rows are matched by what they say and appended with new ids). |
| `empty` | Documents, history and state. Left as the migrations made it. |
| `undecided` | Nobody has said whether its rows are master data or test data. Left empty and listed for the owner. |

A table a later migration adds and nobody listed is treated as `undecided`, and the dry run names it. A table that should move after all changes one line here; the dry run then says whether its foreign keys allow it.

## Trying it on scratch databases

The integration suite does this on every `pnpm check` (two clones of the migrated test template: master rows, changed reference rows and documents in the source; the target gets the master rows and no document; a second run and a database with a document are refused). By hand, against the local PostgreSQL: create an empty database, `pnpm db:migrate` into it with `MIGRATOR_DATABASE_URL` pointing at it, run the seed with it as the target, and drop it afterwards. Never point the target at a database that is in use: the tool would refuse, and it should never have to.
