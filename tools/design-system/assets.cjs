// Writes the files that are copied, never drawn: the brand book, the cover, Inter, lucide's icons
// and the asset groups' notes. Logos and icons are uploads on the page: uploaded-assets.json holds
// their ids, and a file that no longer matches its upload is reported for a new upload.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OUT, ROOT, SOURCE, report, revision } = require('./common.cjs');
const uploaded = require('./uploaded-assets.json');

const rev = revision();
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const packageDir = (name) => {
  const entry = require.resolve(name);
  const marker = path.join('node_modules', name);
  return entry.slice(0, entry.lastIndexOf(marker) + marker.length);
};

write(path.join(OUT, 'README.md'), fs.readFileSync(path.join(SOURCE, 'README.md'), 'utf8').replaceAll('{{REF}}', rev.ref));
write(path.join(OUT, 'components', 'Cover', 'preview.html'), fs.readFileSync(path.join(SOURCE, 'Cover.html')));
for (const group of ['Logos', 'Icons']) {
  write(path.join(OUT, 'assets', group, 'README.md'), fs.readFileSync(path.join(SOURCE, 'assets', group, 'README.md')));
}

// The subsets of Inter the UI uses (tokens.json type.fonts lists the same four).
const inter = path.join(path.dirname(require.resolve('@fontsource-variable/inter/index.css')), 'files');
for (const subset of ['latin-ext', 'cyrillic-ext', 'cyrillic', 'latin']) {
  const name = `inter-${subset}-wght-normal.woff2`;
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(inter, name), path.join(OUT, 'fonts', name));
}

// Exactly lucide's data, as lucide's own SVG wrapper writes it, in a grey that reads on light and
// dark grounds: an <img> cannot inherit a colour.
const lucide = path.join(packageDir('lucide-react'), 'dist', 'esm', 'icons');
function iconNodes(name) {
  const text = fs.readFileSync(path.join(lucide, `${name}.mjs`), 'utf8');
  // Lucide keeps old names as re-exports, such as trash-2 for trash.
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/.exec(text);
  if (alias) return iconNodes(alias[1]);
  const match = /const __iconData = (\{[\s\S]*?\n\});/.exec(text);
  if (!match) throw new Error(`no icon data: ${name}`);
  return new Function(`return ${match[1]}`)().node;
}
const iconInner = (name) =>
  iconNodes(name)
    .map(([tag, attrs]) => {
      const list = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${list}/>`;
    })
    .join('');
for (const { name, sha256 } of uploaded.icons) {
  const file = path.join(OUT, 'assets', 'Icons', `${name}.svg`);
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconInner(name)}</svg>\n`);
  if (sha(file) !== sha256) report(`icon changed: upload ${path.relative(ROOT, file)} and update uploaded-assets.json`);
}
for (const { name, file, sha256 } of uploaded.logos) {
  if (sha(path.join(ROOT, file)) !== sha256) report(`logo changed: upload ${file} as ${name} and update uploaded-assets.json`);
}
