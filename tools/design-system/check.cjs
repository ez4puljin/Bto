// `pnpm design:check [Name,Name]`: renders each built card alone in headless Chrome or Edge, as the
// page's frame does (tokens.css worked out from tokens.json, bundle.css, lib, bundle.js). Reports
// errors and cards whose content runs past their height; exit 1 on an error. Leaves a picture of
// each card in tmp/design-system/check. One card at a time: many frames on one page hang headless
// Chrome. It sees no clicks: try the interactions on the published page.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { OUT, WORK } = require('./common.cjs');

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('no Chrome or Edge found; set CHROME_PATH');
  return found;
}

const CHROME = chromePath();
const dir = path.join(WORK, 'check');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const project = path.relative(dir, OUT).replaceAll(path.sep, '/');

// format.md's "tokens.css as compiled"; the page generates the real one.
const tokens = JSON.parse(fs.readFileSync(path.join(OUT, 'tokens.json'), 'utf8'));
const decl = (list) => list.map((token) => `--${token.name.replace(/\./g, '\\.')}:${token.value};`).join('');
let css = `:root{${decl(tokens.color.tokens)}${decl(tokens.shadow.tokens)}${decl(tokens.spacing.tokens)}${decl(tokens.radius.tokens)}${decl(tokens.controlSize.tokens)}${decl(tokens.layoutWidth.tokens)}${decl(tokens.rootFontSize.tokens)}`;
for (const [key, stack] of Object.entries(tokens.type.families)) css += `--font-${key}:${stack};`;
css += '}\n';
for (const font of tokens.type.fonts) {
  css += `@font-face{font-family:"${font.family}";src:url("${project}/${font.file}") format("woff2");font-weight:${font.weight};font-style:${font.style};}\n`;
}
fs.writeFileSync(path.join(dir, 'tokens.css'), css);

const components = path.join(OUT, 'components');
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const names = fs
  .readdirSync(components)
  .filter((name) => name !== 'Cover' && fs.existsSync(path.join(components, name, 'preview.html')) && (!only || only.has(name)));

const MEASURE = `<script>
window.__errors=window.__errors||[];
setTimeout(function(){
  var bottom=0;
  document.querySelectorAll('#root *').forEach(function(el){if(el.closest('[class*="fixed"]'))return;var r=el.getBoundingClientRect();if(r.height>0&&r.bottom>bottom)bottom=r.bottom;});
  document.querySelectorAll('[data-radix-popper-content-wrapper] *').forEach(function(el){var r=el.getBoundingClientRect();if(r.bottom>bottom)bottom=r.bottom;});
  var out=document.createElement('pre');out.id='__out';out.style.display='none';
  out.textContent=JSON.stringify({errors:window.__errors,bottom:Math.ceil(bottom),rootEmpty:document.getElementById('root').children.length===0,react:window.React&&window.React.version});
  document.body.appendChild(out);
},1800);
</script>`;

const cards = names.map((name) => {
  const html = fs.readFileSync(path.join(components, name, 'preview.html'), 'utf8');
  const height = Number(/height=(\d+)/.exec(html)[1]);
  const width = Number((/ width=(\d+)/.exec(html) ?? [])[1] ?? 800);
  const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];
  const doc = `<!doctype html><html lang="mn" data-theme="light"><head><meta charset="utf-8">
<script>window.__errors=[];addEventListener('error',function(e){window.__errors.push(String(e.message))});addEventListener('unhandledrejection',function(e){window.__errors.push(String(e.reason))});var ce=console.error;console.error=function(){window.__errors.push(Array.from(arguments).join(' ').slice(0,300));ce.apply(console,arguments)};</script>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="${project}/components/bundle.css">
<script src="${project}/components/lib/react.js"></script><script src="${project}/components/lib/react-dom.js"></script><script src="${project}/components/bundle.js"></script>
</head><body>${body}${MEASURE}</body></html>`;
  fs.writeFileSync(path.join(dir, `${name}.html`), doc);
  return { name, height, width };
});

const run = (args) =>
  new Promise((resolve) => {
    execFile(CHROME, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 45000 }, (error, stdout) => resolve({ error, stdout }));
  });

async function checkCard(card, slot) {
  const url = `file:///${path.join(dir, `${card.name}.html`).replace(/\\/g, '/')}`;
  const common = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--disable-extensions', `--user-data-dir=${path.join(dir, `.chrome${slot}`)}`, '--hide-scrollbars', '--virtual-time-budget=3000'];
  const tall = await run([...common, `--window-size=${card.width},1000`, '--dump-dom', url]);
  await run([...common, `--window-size=${card.width},${Math.max(card.height, 120)}`, `--screenshot=${path.join(dir, `${card.name}.png`)}`, url]);
  const match = /<pre id="__out"[^>]*>([\s\S]*?)<\/pre>/.exec(tall.stdout ?? '');
  if (!match) return { ...card, failed: tall.error ? String(tall.error.code ?? tall.error.message) : 'no result' };
  const text = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return { ...card, ...JSON.parse(text) };
}

(async () => {
  const queue = [...cards];
  const results = [];
  await Promise.all(
    [0, 1, 2, 3].map(async (slot) => {
      while (queue.length > 0) results.push(await checkCard(queue.shift(), slot));
    }),
  );
  results.sort((a, b) => a.name.localeCompare(b.name));
  let bad = 0;
  let tall = 0;
  for (const result of results) {
    if (result.failed || result.rootEmpty || result.errors?.length) {
      bad += 1;
      console.log(`ERROR ${result.name}: ${result.failed ?? ''} ${(result.errors ?? []).join(' | ')}`);
    } else if (result.bottom > result.height) {
      tall += 1;
      console.log(`TALL  ${result.name}: content ${result.bottom}, card ${result.height} (cards.json)`);
    }
  }
  for (let slot = 0; slot < 4; slot += 1) fs.rmSync(path.join(dir, `.chrome${slot}`), { recursive: true, force: true });
  console.log(`${results.length} cards, ${bad} with errors, ${tall} too tall; React ${results[0]?.react}; pictures in tmp/design-system/check`);
  if (bad > 0) process.exit(1);
})();
