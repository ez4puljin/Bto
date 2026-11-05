# Design system builder

Rebuilds the «Bto Design System» artifact from this checkout: the tokens, the brand book, the logos and icons, and 34 live component cards running the real code of `apps/web/src`. The artifact is at https://claude.ai/artifact/Ei7xgHAvbVrmpHzcfLpwnR (slug `6f04961c-85d5-4c0b-9fae-e4c6ed7aca6a`), private until the owner shares it.

```bash
pnpm design:build
```

```bash
pnpm design:check
```

`design:build` writes everything to `tmp/design-system/project` (gitignored: the built system is never committed) and lists what moved in the code. `-- --note "<text>"` sets the note of the page's last change. `design:check` renders each card alone in headless Chrome or Edge (`CHROME_PATH`, else the usual install paths), reports errors and cards too short for their content, and leaves pictures in `tmp/design-system/check`.

## What comes from where

| File | From |
|---|---|
| Colours of `tokens.json` | `tokens.cjs` holds the usage notes; each build takes the values of `apps/web/src/index.css` and compares the phone's `apps/mobile/src/theme/tokens.ts`. A changed value is used and reported, because its note may name a contrast that no longer holds. A new variable gets a placeholder note. The phone's new colours are not detected |
| Type, spacing, radii, shadows, control sizes | `tokens.cjs`, by hand: read them against `docs/ui.md` when it changes |
| `README.md` | `source/README.md`, by hand, from `docs/ui.md` |
| Cards | `cards.json` (the list, group, height, width, source files), `source/components/<Name>.md` (guidelines), `source/components/<Name>.preview.jsx` (the live preview) |
| `components/bundle.js`, `lib/` | esbuild over `live/index.jsx`, which exports the real components; not `pnpm build` |
| `components/bundle.css` | Tailwind's compiler over `apps/web/src/index.css`, with the classes of the bundled files and the previews only |
| `components/index.d.ts` | `source/index.d.ts.template`, by hand: props do not follow the code by themselves |
| Logos, icons | `apps/mobile/assets`, lucide-react. They are uploads on the page: `uploaded-assets.json` holds their ids and hashes, and a file that no longer matches is reported |
| Fonts | `@fontsource-variable/inter`, four subsets |

Stand-ins in the bundle: `live/inbox-stub.jsx` (the bell reads the server), `live/camera-stub.jsx` (no camera, no ZXing), `live/provider.jsx` (a test user holding every right). `live/module-tile.jsx` carries the tile's exact classes, because the code has no such component.

## Publishing

Nothing here can publish: it needs Claude Code's artifact tools and the owner's account. Ask Claude Code to publish `tmp/design-system/project` to that artifact. It has to:

1. Read `project/design-system.json` of the live version first and keep any key added on the page; a page save leaves no other trace, and an old version cannot be read back.
2. Upload what the build reported as changed (logos, icons), and put the new ids in `uploaded-assets.json`.
3. Send only the changed files, each as `project/<path>`, with the live version as `base_version` and `mode: "patch"`. The paths must be inside the session's working folder. `tokens.json` goes whole.
4. Open the page and try the cards: `design:check` sees no clicks.

## Adding a card

Add its entry to `cards.json` (order is the page's order), `source/components/<Name>.md` and `<Name>.preview.jsx`, export it from `live/index.jsx`, and write its props in `source/index.d.ts.template`. A preview keeps to these rules, each learned on the real page:

- `width` of at least 800: below Tailwind's `md`, fields show phone-size text and toasts sit at the top.
- `height` is in layout pixels and leaves room for what opens inside it: a menu or a calendar is clipped by its frame.
- The frames refuse a form's submit: answer the submit button and Enter yourself, as `Dialog.preview.jsx` does.
- Do not open a modal on load: it takes the focus and traps the page's wheel. Start closed, or show it first without `modal`, as `Dialog.preview.jsx` does.
- A class no bundled file or preview names has no rule in `bundle.css`, which is built after the previews are read.
