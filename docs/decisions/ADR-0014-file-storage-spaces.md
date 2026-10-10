# ADR-0014: File storage on DigitalOcean Spaces via presigned URLs

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0026 (only the local driver until the go-live phase; the Spaces driver and the weekly dump come with it) |

## Context

Product images, proof-of-delivery photos and signatures, uploaded Excel files, generated PDFs (pick lists, invoices, delivery notes, payslips) and label sheets need durable storage outside the droplet so containers stay stateless and a droplet rebuild loses nothing. Weekly database dumps need an off-cluster home independent of DigitalOcean's managed backups. DigitalOcean Spaces costs $5/month and is S3-compatible (`docs/architecture.md` §13).

## Decision

1. **DigitalOcean Spaces** in SGP1, accessed with `@aws-sdk/client-s3`. One private bucket per environment (`tugeel-prod`, `tugeel-staging`); a CDN-enabled prefix for product images only.
2. **Clients upload directly with presigned PUT URLs** issued by `StorageService.presign(kind, contentType, size)` (identity module); the API never proxies file bodies. `identity.files` records `key`, `kind`, `content_type`, `size`, `sha256`, `owner_id`, `created_at`; a file row is attached to a document (`product_images`, `proof_of_delivery`, `import_jobs`) by id.
3. **Downloads** use short-lived presigned GET URLs (10 minutes) for documents and POD photos; product images are served through the CDN prefix.
4. **Lifecycle.** Versioning enabled on the POD prefix with a 2-year lifecycle; Excel uploads kept 1 year; generated PDFs regenerated on demand and kept 90 days; weekly `pg_dump` archives (`backup.pgdump` job, ADR-0013) land under `backups/` with a 6-month lifecycle.
5. **Local development** uses a filesystem driver (`STORAGE_DRIVER=local`) that writes to `.data/storage/`; the interface (`presign`, `getUrl`, `delete`, `head`) is the same.
6. **Credentials** (Spaces key/secret) live in `/opt/tugeel/.env`, scoped to the bucket, rotated with the secrets runbook.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Droplet disk | Containers become stateful; a rebuild or resize risks data; no versioning. |
| Cloudflare R2 | Cheaper egress, but a second provider account and region for a $5 difference. |
| Supabase Storage | Pulls in a second platform (ADR-0005 reasoning). |
| Proxying uploads through the API | Doubles bandwidth through Singapore and ties up the small API pool. |

## Consequences

**Positive.** Stateless containers; $5/month; an independent backup location; presigned uploads keep large POD photos off the API.

**Negative.** One more credential to rotate; CORS configuration on the bucket must allow the admin and mobile origins; local and Spaces drivers must be kept behaviourally identical (covered by the storage integration test).

**Follow-ups.** Delivery 1: `StorageService`, `files` table, local driver, product image upload, weekly dump job.

## Related

ADR-0012, ADR-0013, ADR-0015, `docs/architecture.md` §4 (identity), §10, §11.
