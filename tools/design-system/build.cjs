// `pnpm design:build`: rebuilds the whole design system from this checkout into
// tmp/design-system/project, ready to check (`pnpm design:check`) and publish. See README.md.
const fs = require('fs');
const path = require('path');
const { OUT, REPORT, ROOT, revision } = require('./common.cjs');

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  require('./tokens.cjs');
  require('./assets.cjs');
  require('./cards.cjs');
  await require('./bundle.cjs')();
  require('./design-index.cjs');
  console.log(`\nBuilt ${revision().ref} into ${path.relative(ROOT, OUT)}`);
  if (REPORT.length > 0) {
    console.log(`\nThe code moved on, ${REPORT.length} to look at:`);
    for (const line of REPORT) console.log(`- ${line}`);
  } else {
    console.log('Colours and uploads match the code.');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
