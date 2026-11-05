// Writes every card (preview.html from source/components/<Name>.preview.jsx, README.md from
// <Name>.md) and index.d.ts.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { OUT, SOURCE, revision } = require('./common.cjs');
const cards = require('./cards.json');

const rev = revision();
const root = path.join(OUT, 'components');

for (const card of cards) {
  const dir = path.join(root, card.name);
  fs.mkdirSync(dir, { recursive: true });
  const code = fs.readFileSync(path.join(SOURCE, 'components', `${card.name}.preview.jsx`), 'utf8');
  // Classic script with no build step on the page, and readable by whoever opens the card's file.
  const js = esbuild
    .transformSync(code, { loader: 'jsx', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', charset: 'utf8', target: 'es2022' })
    .code.replace(/\/\* @__PURE__ \*\/ /g, '');
  if (/<\/script|<!--/i.test(js)) throw new Error(`${card.name}: its script text would end the element`);
  const subtitle = card.source[0].replace('apps/web/src/', '');
  const html = `<!-- @dsCard group="${card.group}" height=${card.height} width=${card.width} subtitle="${subtitle}" -->
<!doctype html>
<html lang="mn">
<head><meta charset="utf-8"><title>${card.name} preview</title></head>
<body>
<div id="root"></div>
<script>
${js}</script>
</body>
</html>
`;
  if (html.length > 256 * 1024) throw new Error(`${card.name}: preview over 256 KB`);
  fs.writeFileSync(path.join(dir, 'preview.html'), html);
  const guidelines = fs.readFileSync(path.join(SOURCE, 'components', `${card.name}.md`), 'utf8').trimEnd();
  const from = card.source.map((file) => `\`${file}\``).join(', ');
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    `# ${card.name}\n\n${guidelines}\n\nBuilt from ${from} at ${rev.ref}: the preview mounts the real component from \`window.Bto\`.\n`,
  );
}
fs.writeFileSync(path.join(root, 'index.d.ts'), fs.readFileSync(path.join(SOURCE, 'index.d.ts.template'), 'utf8').replaceAll('{{REF}}', rev.ref));
console.log(`cards: ${cards.length}`);
