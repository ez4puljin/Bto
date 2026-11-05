// Writes design-system.json, the page's index. Publishing reads the live one first and keeps any
// key added on the page: see README.md.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OUT, ROOT, revision } = require('./common.cjs');
const uploaded = require('./uploaded-assets.json');

const rev = revision();
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const noteArg = process.argv.indexOf('--note');
const note = noteArg > 0 ? process.argv[noteArg + 1] : `Re-synced to ${rev.ref}.`;

// A file that no longer matches its upload keeps its old record until it is uploaded again
// (assets.cjs reports it), so the page never shows a broken tile.
const logoFiles = {};
for (const { name, blob, size } of uploaded.logos) logoFiles[name] = { name, blob, size, type: 'image/png' };
const iconFiles = {};
for (const { name: stem, blob, size } of uploaded.icons) {
  const name = `${stem}.svg`;
  iconFiles[name] = { name, blob, size, type: 'image/svg+xml' };
}
const matching = uploaded.logos.filter(({ file, sha256 }) => sha(path.join(ROOT, file)) === sha256).length;

const index = {
  v: 3,
  layout: 'files',
  createdOnFiles: { v: 1, at: '2026-11-05T09:30:56Z' },
  title: 'Bto Design System',
  namespace: 'Bto',
  libraries: [
    { name: 'react', version: require('react/package.json').version, global: 'React', file: 'components/lib/react.js' },
    { name: 'react-dom', version: require('react-dom/package.json').version, global: 'ReactDOM', file: 'components/lib/react-dom.js' },
  ],
  sections: {},
  groups: ['Logos', 'Icons'],
  assetGroups: {
    Logos: { name: 'Logos', tile: 'm', order: uploaded.logos.map(({ name }) => name), files: logoFiles },
    Icons: { name: 'Icons', tile: 'xs', order: uploaded.icons.map(({ name }) => `${name}.svg`), files: iconFiles },
  },
  blobs: {},
  docs: { readme: 'project/README.md', sections: [] },
  lastChange: {
    by: 'ez4puljin',
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    via: `GitHub · ez4puljin/Bto@${rev.sha}`,
    note,
  },
};
fs.writeFileSync(path.join(OUT, 'design-system.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`design-system.json: ${matching} of ${uploaded.logos.length} logos and the icons as uploaded`);
