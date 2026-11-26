import { createRequire } from 'node:module';
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertQaUrl, assertRunDirectory, parseEnvironment } from './safety.mjs';
import { QA_DATABASE, DATASET_ID } from './dataset.mjs';
import { hash } from './journal.mjs';

/** One reviewed correction of a proven validation rejection. Never changes business data. */
export async function repairRejectedLocation(
  { repo, explicitlyEnabled, database },
  { read = readFile, openLock = open } = {},
) {
  if (explicitlyEnabled !== true || database !== QA_DATABASE)
    throw new Error('Explicit exact-QA repair required');
  if (typeof repo !== 'string' || !repo.trim()) throw new Error('Explicit --repo is required');
  const checkout = resolve(repo),
    directory = assertRunDirectory(checkout);
  const env = parseEnvironment(await read(join(directory, 'qa.env'), 'utf8'));
  assertQaUrl(env.DATABASE_URL);
  const lockPath = join(directory, 'run.lock'),
    lock = await openLock(lockPath, 'wx');
  let reader;
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        task: 'reviewed rejected location repair',
        at: new Date().toISOString(),
      }),
    );
    const require = createRequire(join(checkout, 'apps/api/package.json'));
    const { Client } = require('pg');
    reader = new Client({ connectionString: env.DATABASE_URL });
    await reader.connect();
    await reader.query('SET default_transaction_read_only=on');
    const target = (
      await reader.query('SELECT current_database() AS database,current_user AS role')
    ).rows[0];
    if (target.database !== QA_DATABASE || target.role !== 'app')
      throw new Error('Repair target mismatch');
    const path = join(directory, 'run.json'),
      logPath = join(directory, 'operations.ndjson');
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.dataset !== DATASET_ID) throw new Error('Wrong repair manifest dataset');
    const events = (await readFile(logPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const event of events) {
      if (event.dataset !== DATASET_ID) throw new Error('Wrong repair operation log dataset');
      state.operations[event.key] = event.operation;
    }
    const key = 'catalogue/location/0/2',
      old = state.operations[key];
    const product = state.refs.products?.[0],
      warehouse = state.refs.warehouses?.[2];
    const floor = state.refs.floors?.[2],
      shelf = state.refs.bins?.[2];
    if (!product || !warehouse || !floor || !shelf)
      throw new Error('Missing exact rejected-location references');
    const oldBody = {
      productId: product.id,
      warehouseId: warehouse.id,
      defaultBinId: floor.id,
      minQty: '3',
      maxQty: '24',
    };
    const newBody = { ...oldBody, defaultBinId: shelf.id };
    const specification = (body) => ({
      method: 'PUT',
      path: '/product-locations',
      body,
      idempotent: true,
    });
    if (old?.status !== 'PENDING' || old.hash !== hash(specification(oldBody)))
      throw new Error('Repair only permits the exact original floor-bin rejection');
    const absent = (
      await reader.query(
        'SELECT product_id FROM product_locations WHERE product_id=$1 AND warehouse_id=$2',
        [product.id, warehouse.id],
      )
    ).rows;
    if (absent.length) throw new Error('Rejected location exists; stop for inspection');
    const bins = (
      await reader.query('SELECT id,warehouse_id,type FROM bins WHERE id=ANY($1::bigint[])', [
        [floor.id, shelf.id],
      ])
    ).rows;
    if (
      bins.length !== 2 ||
      !bins.some(
        (b) =>
          Number(b.id) === floor.id &&
          b.type === 'SALESFLOOR' &&
          Number(b.warehouse_id) === warehouse.id,
      ) ||
      !bins.some(
        (b) =>
          Number(b.id) === shelf.id &&
          b.type === 'PICKING' &&
          Number(b.warehouse_id) === warehouse.id,
      )
    )
      throw new Error('Repair bin provenance mismatch');
    const proofPath = join(
      checkout,
      '.data/local-dev/qa-six-month/rejected-catalogue-execution.log',
    );
    const proof = await readFile(proofPath, 'utf8');
    if (
      !proof.includes('/product-locations') ||
      !proof.includes('422') ||
      !proof.includes('defaultBinId')
    )
      throw new Error('Missing actual validation-rejection evidence');
    const operation = {
      ...old,
      status: 'REJECTED',
      allowedReplacementHash: hash(specification(newBody)),
      rejectionEvidence: {
        repairedAt: new Date().toISOString(),
        proofPath,
        proofHash: hash(proof),
        reason:
          'Actual HTTP 422 defaultBinId validation; read-only proof of absent business row; replace SALESFLOOR with PICKING shelf',
        database: target.database,
        productId: product.id,
        warehouseId: warehouse.id,
        bins,
        locationRows: 0,
        oldPayloadHash: hash(oldBody),
        replacementPayloadHash: hash(newBody),
      },
    };
    const file = await open(logPath, 'a', 0o600);
    try {
      await file.writeFile(JSON.stringify({ dataset: DATASET_ID, key, operation }) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    state.operations[key] = operation;
    await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    process.stdout.write(
      'Archived exact rejected attempt and authorized one payload replacement; business rows unchanged\n',
    );
  } finally {
    try {
      await reader?.end();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (
    args.length !== 5 ||
    args[0] !== '--apply' ||
    args[1] !== '--repo' ||
    args[3] !== '--database'
  )
    throw new Error('Use --apply --repo <installed> --database bto_qa_six_month_20261124');
  repairRejectedLocation({ explicitlyEnabled: true, repo: args[2], database: args[4] }).catch(
    (error) => {
      process.stderr.write(`${error.stack}\n`);
      process.exitCode = 1;
    },
  );
}
