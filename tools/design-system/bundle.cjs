// Builds components/bundle.js, bundle.css and lib/*.js from the repository's own sources: esbuild
// over the real components, Tailwind's compiler over apps/web/src/index.css. Not `pnpm build`.
const { compile, optimize } = require('@tailwindcss/node');
const { Scanner } = require('@tailwindcss/oxide');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { HERE, ROOT, SHARED, SOURCE, WEB, OUT, revision } = require('./common.cjs');
const cards = require('./cards.json');

const LIVE = path.join(HERE, 'live');
const COMPONENTS = path.join(OUT, 'components');

// Modules that would read the server or open a camera: stand-ins, named in the brand book.
const STUBS = {
  '@/features/notifications/inbox': path.join(LIVE, 'inbox-stub.jsx'),
  '@/lib/scan/camera': path.join(LIVE, 'camera-stub.jsx'),
};

const GLOBALS = {
  react: 'module.exports = window.React;',
  'react-dom': 'module.exports = window.ReactDOM;',
  'react-dom/client': 'module.exports = window.ReactDOM;',
  'react/jsx-runtime': `var R = window.React;
exports.Fragment = R.Fragment;
exports.jsx = exports.jsxs = function (type, props, key) {
  return R.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key }));
};`,
};
GLOBALS['react/jsx-dev-runtime'] = GLOBALS['react/jsx-runtime'];

// Only the dictionary's keys these files name: the rest of the app's text (admin hints, examples of
// server addresses) has no business in a design reference. Whole namespaces for keys built at run
// time, such as `errors.${code}`.
const WHOLE = new Set(['errors', 'validation', 'calendar']);
function pruneDictionary(all, keys, prefixes) {
  const walk = (node, trail) => {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const dotted = trail ? `${trail}.${key}` : key;
      if (typeof value === 'string') {
        const base = dotted.replace(/_(zero|one|two|few|many|other)$/, '');
        if (keys.has(dotted) || keys.has(base) || prefixes.some((prefix) => dotted.startsWith(prefix))) out[key] = value;
      } else {
        const inner = walk(value, dotted);
        if (Object.keys(inner).length > 0) out[key] = inner;
      }
    }
    return out;
  };
  return walk(all, '');
}

function plugin(dictionary) {
  return {
    name: 'bto',
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime)$/ }, (args) => ({
        path: args.path,
        namespace: 'bto-global',
      }));
      build.onLoad({ filter: /.*/, namespace: 'bto-global' }, (args) => ({ contents: GLOBALS[args.path], loader: 'js' }));
      build.onResolve({ filter: /^@\// }, (args) => {
        if (STUBS[args.path]) return { path: STUBS[args.path] };
        return build.resolve(`./${args.path.slice(2)}`, { resolveDir: WEB, kind: args.kind });
      });
      // The shared package's sources, by the paths of its exports map: no build of the packages needed.
      build.onResolve({ filter: /^@tugeel\/shared(\/|$)/ }, (args) => {
        const sub = args.path.slice('@tugeel/shared'.length).replace(/^\//, '');
        if (sub === 'i18n/mn.json') return { path: path.join(SHARED, 'i18n', 'mn.json') };
        return { path: path.join(SHARED, 'src', sub || '.', 'index.ts') };
      });
      if (dictionary) {
        build.onLoad({ filter: /[\\/]i18n[\\/]mn\.json$/ }, () => ({ contents: JSON.stringify(dictionary), loader: 'json' }));
      }
    },
  };
}

// A consumer may inline these files in a page.
const safeScript = (text) => text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  charset: 'utf8',
  legalComments: 'inline',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  logLevel: 'warning',
  absWorkingDir: ROOT,
};

async function buildBundle() {
  const header = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: 'Bto', components: cards.map(({ name }) => ({ name })) })} */`;
  const options = {
    ...common,
    entryPoints: [path.join(LIVE, 'index.jsx')],
    globalName: 'Bto',
    banner: { js: header },
    write: false,
    metafile: true,
  };
  // First pass: which files the bundle holds, and so which keys of mn.json they name.
  const first = await esbuild.build({ ...options, plugins: [plugin(null)] });
  const own = Object.keys(first.metafile.inputs)
    .filter((file) => !file.startsWith('bto-global:'))
    .map((file) => path.resolve(ROOT, file))
    .filter((file) => /[\\/](apps[\\/]web|packages[\\/]shared[\\/]src|tools[\\/]design-system[\\/]live)[\\/]/.test(file) && !file.endsWith('.json'));
  const mn = JSON.parse(fs.readFileSync(path.join(SHARED, 'i18n', 'mn.json'), 'utf8'));
  const keys = new Set(['app.name']);
  const prefixes = [...WHOLE].map((name) => `${name}.`);
  for (const file of own) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/['"`]([a-zA-Z]+(?:\.[\w-]+)+)['"`]/g)) keys.add(match[1]);
    for (const match of text.matchAll(/`([a-zA-Z]+(?:\.[\w-]+)*\.)\$\{/g)) {
      if (!prefixes.includes(match[1])) prefixes.push(match[1]);
    }
  }
  const dictionary = pruneDictionary(mn, keys, prefixes);
  const second = await esbuild.build({ ...options, plugins: [plugin(dictionary)] });
  const js = safeScript(second.outputFiles[0].text);
  if (!js.startsWith('/* @ds-bundle:')) throw new Error('the header is not on line 1');
  if (Buffer.byteLength(js) > 6 * 1024 * 1024) throw new Error('bundle.js over 6 MB');
  fs.writeFileSync(path.join(COMPONENTS, 'bundle.js'), js);
  console.log(`bundle.js: ${Math.round(Buffer.byteLength(js) / 1024)} KiB`);
  return own;
}

// React 19 has no ready-made classic scripts, and these components take `ref` as a plain prop, so
// React 18 would not do.
async function buildLibs() {
  fs.mkdirSync(path.join(COMPONENTS, 'lib'), { recursive: true });
  const react = await esbuild.build({
    ...common,
    stdin: { contents: `window.React = require('react');`, resolveDir: ROOT, loader: 'js' },
    write: false,
  });
  fs.writeFileSync(path.join(COMPONENTS, 'lib', 'react.js'), safeScript(react.outputFiles[0].text));
  const dom = await esbuild.build({
    ...common,
    stdin: {
      contents: `var dom = require('react-dom');
var client = require('react-dom/client');
window.ReactDOM = Object.assign({}, dom, client);`,
      resolveDir: ROOT,
      loader: 'js',
    },
    write: false,
    plugins: [
      {
        name: 'react-global',
        setup(build) {
          build.onResolve({ filter: /^react$/ }, (args) => ({ path: args.path, namespace: 'bto-global' }));
          build.onLoad({ filter: /.*/, namespace: 'bto-global' }, () => ({ contents: GLOBALS.react, loader: 'js' }));
        },
      },
    ],
  });
  fs.writeFileSync(path.join(COMPONENTS, 'lib', 'react-dom.js'), safeScript(dom.outputFiles[0].text));
  for (const name of ['react.js', 'react-dom.js']) {
    if (fs.statSync(path.join(COMPONENTS, 'lib', name)).size > 2 * 1024 * 1024) throw new Error(`${name} over 2 MB`);
  }
}

async function buildCss(own) {
  const rev = revision();
  const indexCss = path.join(WEB, 'index.css');
  const compiler = await compile(fs.readFileSync(indexCss, 'utf8'), {
    base: path.dirname(indexCss),
    onDependency: () => undefined,
    shouldRewriteUrls: false,
  });
  const previews = fs
    .readdirSync(path.join(SOURCE, 'components'))
    .filter((name) => name.endsWith('.preview.jsx'))
    .map((name) => path.join(SOURCE, 'components', name));
  const candidates = new Scanner({ sources: [] }).scanFiles(
    [...own, ...previews].map((file) => ({ content: fs.readFileSync(file, 'utf8'), extension: path.extname(file).slice(1) })),
  );
  const optimized = optimize(compiler.build([...new Set(candidates)]), { minify: true });
  let css = typeof optimized === 'string' ? optimized : optimized.code;
  // Inter's faces come from tokens.css (fonts/*.woff2); fontsource's relative urls lead nowhere here.
  css = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  if (/<\/style/i.test(css)) throw new Error('</style in bundle.css');
  const head = `/* Bto: apps/web/src/index.css compiled by Tailwind ${require('tailwindcss/package.json').version} over the classes of the bundled components, at ${rev.ref}. */\n`;
  fs.writeFileSync(path.join(COMPONENTS, 'bundle.css'), `${head}${css}\n`);
  console.log(`bundle.css: ${Math.round(css.length / 1024)} KiB`);
}

module.exports = async function buildAll() {
  fs.mkdirSync(COMPONENTS, { recursive: true });
  const own = await buildBundle();
  await buildLibs();
  await buildCss(own);
};
