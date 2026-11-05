// Writes tokens.json. The usage notes and the type, spacing and shadow scales are kept here by
// hand, from apps/web/src/index.css, the classes of apps/web/src/components and
// apps/mobile/src/theme/tokens.ts. The colours are checked against the code on every build.
const fs = require('fs');
const path = require('path');
const { OUT, revision, syncColors } = require('./common.cjs');
const rev = revision();
const out = path.join(OUT, 'tokens.json');

const c = (name, value, usage) => ({ name, value, usage });

const color = [
  // apps/web/src/index.css :root, in its order
  c('canvas', '#f2f2f7', 'The page behind the cards: body and main. Never a card or a field.'),
  c(
    'background',
    '#ffffff',
    'Fields, outline buttons, the top bar, FormSection boxes, the ring offset of a focused button.',
  ),
  c(
    'foreground',
    '#1d1d1f',
    'Body text on background, card, popover, canvas, accent, fill and secondary (13.8:1 or more). Also the ground of the dark toast.',
  ),
  c('card', '#ffffff', 'Cards, list cards and home tiles on the canvas.'),
  c('card-foreground', '#1d1d1f', 'Text on card (16.8:1).'),
  c('popover', '#ffffff', 'Menus, dialogs, sheets and calendars.'),
  c('popover-foreground', '#1d1d1f', 'Text on popover (16.8:1).'),
  c(
    'primary',
    '#0071e3',
    'FILLS ONLY: the one main button of a view, checked boxes, step circles, the active tab rule, the brand mark. As text it reads 4.7:1 on white but 4.2:1 on canvas, so blue text uses link.',
  ),
  c('primary-hover', '#0066cc', 'The main button under the pointer (white on it reads 5.6:1).'),
  c(
    'primary-foreground',
    '#ffffff',
    'Text and icons on primary (4.7:1) and primary-hover (5.6:1).',
  ),
  c(
    'secondary',
    '#e8f0fb',
    'Tinted buttons such as «Засах», active filter pills, highlighted menu items, the open module in the top bar.',
  ),
  c('secondary-hover', '#dce8f8', 'A tinted button or pill under the pointer.'),
  c(
    'secondary-foreground',
    '#0066cc',
    'Text on secondary (4.85:1). On secondary-hover it reads 4.49:1, just under AA: a hover state kept exact from the source.',
  ),
  c(
    'muted',
    '#f2f2f7',
    'Disabled fields, the head of paper tables, table footers at 60%. Same value as canvas.',
  ),
  c(
    'muted-foreground',
    '#636366',
    'Secondary text, breadcrumbs, table heads and captions on background (6:1), canvas (5.4:1), accent (5.3:1) and fill (4.9:1). Darkened for AA in ADR-0113.',
  ),
  c('accent', '#f0f0f5', 'Hover surfaces: table rows, ghost and outline buttons, an open row.'),
  c('accent-foreground', '#1d1d1f', 'Text on accent (14.8:1).'),
  c(
    'link',
    '#0066cc',
    'BLUE TEXT: links, the active menu entry, info badges, on background (5.6:1), canvas (5:1), accent (4.9:1) and info-soft (4.85:1).',
  ),
  c(
    'destructive',
    '#d70015',
    'Refused or broken: red text and icons on background (5.4:1) and danger-soft (4.56:1), field errors, the warning toast ground (white on it 5.4:1).',
  ),
  c(
    'danger-soft',
    '#fde7e8',
    'Ground of the red pill, the error alert and the destructive button.',
  ),
  c('success', '#1e7b34', 'Done or active: text on success-soft (4.69:1) and background (5.3:1).'),
  c('success-soft', '#e3f5e7', 'Ground of the green status pill.'),
  c(
    'warning',
    '#b25000',
    'Needs attention: text on warning-soft (4.67:1) and background (5.2:1); a starred page.',
  ),
  c('warning-soft', '#fff1de', 'Ground of the orange status pill.'),
  c('info-soft', '#e8f0fb', 'Ground of the blue in-progress pill, under link text (4.85:1).'),
  c(
    'fill',
    '#e8e8ed',
    "Neutral pills, the empty-state disc, skeleton bars, a fact chip's label, a switch that is off (1.22:1 on white, kept from the source: the thumb's shadow carries the shape).",
  ),
  c(
    'toggle',
    '#248a3d',
    'A switch that is on (4.4:1 against its white thumb) and the tick of a success toast (3.8:1 on the dark pill).',
  ),
  c(
    'border',
    '#e5e5ea',
    'Hairlines between rows and around boxes. 1.26:1 on white, so it decorates: never the only boundary of a control.',
  ),
  c(
    'input',
    '#8e8e93',
    "Field and checkbox borders: 3.26:1 on white, a field's boundary (ADR-0113). On canvas it reads 2.92:1, so fields sit on cards or carry a white ground.",
  ),
  c('ring', '#0071e3', 'Focus rings: 4.7:1 on white, 4.2:1 on canvas.'),
  c('chart-1', '#0071e3', 'First series of a Recharts chart (4.7:1 on the card).'),
  c(
    'chart-2',
    '#34c759',
    'Second series, on time in the attendance chart. 2.22:1 on the card: misses 3:1, kept from the source, so label series and never rely on colour alone.',
  ),
  c(
    'chart-3',
    '#ff9500',
    'Third series, late in the attendance chart. 2.2:1 on the card: misses 3:1, kept from the source.',
  ),
  c('chart-4', '#af52de', 'Fourth series (4.13:1 on the card).'),
  c('chart-5', '#5ac8fa', 'Fifth series. 1.9:1 on the card: misses 3:1, kept from the source.'),
  c('sidebar', '#f9f9fb', 'The «Бүх цэс» drawer.'),
  c('sidebar-foreground', '#1d1d1f', 'Text on sidebar (16:1).'),
  c('sidebar-primary', '#0071e3', 'A fill inside the drawer.'),
  c('sidebar-primary-foreground', '#ffffff', 'Text on sidebar-primary.'),
  c('sidebar-accent', '#e8f0fb', 'The lit entry and the hover of the drawer.'),
  c('sidebar-accent-foreground', '#0066cc', 'Text on sidebar-accent (4.85:1).'),
  c('sidebar-border', '#e5e5ea', 'Hairlines in the drawer.'),
  c('sidebar-ring', '#0071e3', 'Focus rings in the drawer.'),
  // Literals the classes repeat (not variables in index.css; the values are exact)
  c(
    'hairline-ring',
    'rgba(0,0,0,0.06)',
    'The 1px ring of cards, list cards, menus, dialogs and floating bars (class ring-1 ring-black/[0.06]).',
  ),
  c(
    'overlay',
    'rgba(0,0,0,0.25)',
    'Behind a dialog or a sheet (class bg-black/25, with a 2px backdrop blur).',
  ),
  c('overlay-drawer', 'rgba(0,0,0,0.3)', 'Behind the «Бүх цэс» drawer (class bg-black/30).'),
  c(
    'segment-track',
    'rgba(0,0,0,0.05)',
    "The track of a segmented control and the top bar's search pill (class bg-black/[0.05]).",
  ),
  // Phone apps: apps/mobile/src/theme/tokens.ts, only what differs from or adds to the web
  c(
    'app-muted',
    '#6e6e73',
    'Phone apps: secondary text (5:1 on white, 4.54:1 on canvas). The web moved to muted-foreground in ADR-0113; the phone did not.',
  ),
  c(
    'app-label2',
    '#3a3a3c',
    "Phone apps: secondary text on a grey chip (9.3:1 on fill), a field's label.",
  ),
  c(
    'app-input',
    '#c7c7cc',
    "Phone apps: a field's border. 1.68:1 on white, misses 3:1; the web moved to input in ADR-0113, the phone did not.",
  ),
  c(
    'app-field',
    '#efeff0',
    "Phone apps: a text field's box, solid so its idle border can match it.",
  ),
  c(
    'app-placeholder',
    '#8e8e93',
    'Phone apps: placeholders. 3.26:1 on white, misses 4.5:1, kept from the source.',
  ),
  c(
    'app-warning-text',
    '#8a3f00',
    'Phone apps: text on the orange note under a quantity beyond the stock (6.8:1 on warning-soft).',
  ),
  c(
    'app-destructive-text',
    '#a3000f',
    'Phone apps: text on the soft red of a discount (6.9:1 on danger-soft).',
  ),
  c(
    'app-promo-text',
    '#b4400b',
    "Phone apps: a promotion notice's eyebrow on its warm picture (5.7:1 on white).",
  ),
  c(
    'app-deal-promotion',
    '#ff9500',
    'Bto300: the promotion badge, with dark text (foreground on it 7.65:1), never white.',
  ),
  c('app-deal-discount', '#d70015', 'Bto300: the discount badge, with white text (5.4:1).'),
  c('app-new-badge', '#0058b0', 'Bto300: the «Шинэ» badge, with white text (6.95:1).'),
  c('app-heart', '#d70015', 'Phone apps: a ♡ that is on.'),
  c('app-violet', '#4b3fc9', 'Phone apps: a status tint (7.4:1 on white).'),
  c('app-violet-soft', '#efedfd', 'Phone apps: ground under app-violet.'),
  c('app-cancelled', '#c00012', 'Phone apps: a cancelled order (6.5:1 on white).'),
  c(
    'app-blocked',
    '#1c1c1e',
    'Staff app: a store on credit hold: its map pin, dot and card banner.',
  ),
  c('app-image-fill', '#f5f5f7', 'Phone apps: behind a product picture.'),
  c('app-dot-idle', '#d1d1d6', 'Phone apps: a pager dot that is not the current page.'),
  c('app-keypad-bar', '#f6f6f8', "Staff app: the quantity keypad's bar."),
  c('app-keypad-tray', '#d1d4da', "Staff app: the tray under the keypad's keys."),
  c(
    'app-field-fill',
    'rgba(118,118,128,0.12)',
    "Phone apps: the search field, segmented controls and the stepper's track.",
  ),
  c('app-switch-off', 'rgba(120,120,128,0.16)', "Phone apps: a switch's track when off."),
  c('app-close-fill', 'rgba(118,118,128,0.14)', "Phone apps: a sheet's round close button."),
  c('app-range-fill', 'rgba(0,113,227,0.12)', 'Phone apps: the tinted range of a calendar.'),
  c('app-backdrop', 'rgba(0,0,0,0.32)', 'Phone apps: behind a sheet.'),
  c('app-dim-fill', 'rgba(0,0,0,0.25)', 'Phone apps: behind the «sent» card.'),
  c('app-popup-backdrop', 'rgba(0,0,0,0.45)', 'Phone apps: behind a popup.'),
  c(
    'app-bar-fill',
    'rgba(255,255,255,0.96)',
    'Phone apps: bars over content, nearly opaque since Android has no blur.',
  ),
  c('app-sheet-bar-fill', 'rgba(242,242,247,0.96)', "Phone apps: a sheet's bar."),
  c('app-floating-fill', 'rgba(255,255,255,0.92)', 'Phone apps: the floating tab bar.'),
  c('app-glass-fill', 'rgba(255,255,255,0.86)', 'Phone apps: a round button over a picture.'),
  c(
    'app-on-primary-muted',
    'rgba(255,255,255,0.72)',
    'Phone apps: quiet text on the blue month card.',
  ),
  c(
    'app-on-primary-hairline',
    'rgba(255,255,255,0.22)',
    'Phone apps: lines on the blue month card.',
  ),
  c('app-dot-on-image', '#ffffff', 'Phone apps: the current pager dot over a picture.'),
  c(
    'app-dot-on-image-idle',
    'rgba(255,255,255,0.55)',
    'Phone apps: other pager dots over a picture.',
  ),
  c('app-pager-capsule', 'rgba(0,0,0,0.24)', 'Phone apps: the dark capsule under pager dots.'),
  c('app-hairline', 'rgba(0,0,0,0.08)', 'Phone apps: the usual hairline.'),
  c('app-hairline-soft', 'rgba(0,0,0,0.06)', 'Phone apps: a quieter hairline.'),
  c('app-hairline-strong', 'rgba(0,0,0,0.15)', 'Phone apps: a stronger hairline.'),
  c('app-tint-blue', '#0a84ff', 'Phone apps: icon tiles, dots and avatars; first avatar tint.'),
  c('app-tint-indigo', '#5e5ce6', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-green', '#34c759', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-orange', '#ff9500', 'Phone apps: icon tiles and dots.'),
  c('app-tint-amber', '#ff9f0a', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-red', '#ff3b30', 'Phone apps: icon tiles and dots.'),
  c('app-tint-pink', '#ff2d55', 'Phone apps: icon tiles and dots.'),
  c('app-tint-rose', '#ff375f', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-teal', '#30b0c7', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-cyan', '#64d2ff', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-purple', '#bf5af2', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-brown', '#ac8e68', 'Phone apps: icon tiles and avatars.'),
  c('app-tint-gray', '#8e8e93', 'Phone apps: icon tiles and dots.'),
];

const s = (name, fontSize, lineHeight, fontWeight, extra = {}) => ({
  name,
  fontSize,
  lineHeight,
  fontWeight,
  ...extra,
});
const TIGHT = '-0.025em';
const face = (name, weight, size, lh, ls = 0, extra = {}) =>
  s(name, `${size}px`, `${lh}px`, weight, {
    ...(ls ? { letterSpacing: `${ls}px` } : {}),
    ...extra,
  });

const type = {
  fonts: [
    // A composite face: the last file is checked first for a character, so Latin leads, then
    // Cyrillic, then Cyrillic Extended for Ө and Ү, then Latin Extended for ₮.
    {
      family: 'Inter Variable',
      file: 'fonts/inter-latin-ext-wght-normal.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      family: 'Inter Variable',
      file: 'fonts/inter-cyrillic-ext-wght-normal.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      family: 'Inter Variable',
      file: 'fonts/inter-cyrillic-wght-normal.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      family: 'Inter Variable',
      file: 'fonts/inter-latin-wght-normal.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  families: {
    sans: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    mono: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  },
  groups: [
    {
      name: 'Titles',
      family: 'sans',
      styles: [
        s('page-title', '1.75rem', 1.25, 600, {
          letterSpacing: TIGHT,
          sample: 'Агуулах',
          usage:
            'The h1 of PageHeader, leading-tight and tracking-tight, foreground on canvas. docs/ui.md says 26px; the code is 28px at a 16px root.',
        }),
        s('panel-title', '1.125rem', '1.75rem', 600, {
          letterSpacing: TIGHT,
          sample: '20261015_0003',
          usage: 'The number or name of a record in RecordSheet.',
        }),
        s('dialog-title', '1.0625rem', 1.375, 600, {
          letterSpacing: TIGHT,
          sample: 'Шинэ утга оруулах',
          usage: 'DialogTitle, SheetTitle and the brand name in the top bar.',
        }),
        s('card-title', '0.9375rem', 1.375, 600, {
          letterSpacing: TIGHT,
          sample: 'Падааны мэдээлэл',
          usage: 'CardTitle. A small card (size sm) drops to body size.',
        }),
        s('section-title', '0.75rem', '1rem', 600, {
          letterSpacing: '0.025em',
          sample: 'ЕРӨНХИЙ',
          usage:
            'FormSection, FieldList and PanelSection titles: muted-foreground and upper case by CSS (text-transform), the source text stays in sentence case.',
        }),
      ],
    },
    {
      name: 'Text',
      family: 'sans',
      styles: [
        s('body', '0.875rem', '1.25rem', 400, {
          sample: 'Өнөөдөр таныг хүлээж буй ажил.',
          usage:
            'All body text, table cells and field values. Set on body; fields read 1rem on a phone so it does not zoom.',
        }),
        s('body-medium', '0.875rem', '1.25rem', 500, {
          sample: 'Цааш үзэх',
          usage: "Button labels other than the main one, alert titles, SelectionBar's count.",
        }),
        s('button-main', '0.875rem', '1.25rem', 600, {
          sample: 'Хадгалах',
          usage: 'The label of the default (blue) button.',
        }),
        s('button-lg', '0.9375rem', 1.42857, 500, {
          sample: 'Төлбөр (F12)',
          usage: 'A large button (h-11).',
        }),
        s('secondary-text', '0.8125rem', 1.42857, 400, {
          sample: 'Шүүлтүүр арилгах',
          usage:
            "Breadcrumbs, the header's meta row and description, card and dialog descriptions, dt labels.",
        }),
        s('pill-text', '0.8125rem', 1.42857, 500, {
          sample: 'Бүх агуулах',
          usage: 'Filter pills, tabs, segments, small buttons and the toast.',
        }),
        s('field-label', '0.8125rem', 1, 500, {
          sample: 'Нэр',
          usage: 'Label: foreground, foreground at 80% in FormRow.',
        }),
        s('caption', '0.75rem', '1rem', 400, {
          sample: 'Заавал бөглөнө',
          usage:
            'Hints under fields, muted-foreground. Nothing on screen is smaller than 12px except the paper and the step number.',
        }),
        s('caption-medium', '0.75rem', '1rem', 500, {
          sample: 'Төлөв',
          usage: 'Table heads and badges.',
        }),
        s('step-number', '0.6875rem', 1.42857, 600, {
          sample: '2',
          usage: "The numeral of FormSection's step circle, white on primary; aria-hidden.",
        }),
      ],
    },
    {
      name: 'Figures',
      family: 'mono',
      styles: [
        s('figure', '0.875rem', '1.25rem', 400, {
          sample: '1,240,500₮',
          usage:
            'font-mono means Inter with tabular figures (font-feature-settings "tnum"): money, counts and codes, right-aligned in columns.',
        }),
        s('figure-strong', '0.875rem', '1.25rem', 600, {
          sample: '12,000₮',
          usage: 'The value of a TotalsGrid tile.',
        }),
      ],
    },
    {
      name: 'Paper',
      family: 'sans',
      styles: [
        s('book-cell', '13px', 1.42857, 400, {
          sample: 'НИЙТ ДҮН',
          usage: "BookTable cells on a report's paper page at 1600px and wider.",
        }),
        s('book-cell-compact', '12px', 1.42857, 400, {
          sample: 'НИЙТ ДҮН',
          usage: 'BookTable cells below 1600px.',
        }),
        s('print-cell', '11px', 1.42857, 400, {
          sample: 'НИЙТ ДҮН',
          usage: 'BookTable cells in print, table-auto.',
        }),
        s('roll-text', '12px', 1.42857, 400, {
          sample: 'Хэвлэсэн: 2026-11-01 08:30',
          usage: 'The 80 mm roll: a 72 mm column, black only, no grey and no backgrounds.',
        }),
      ],
    },
    {
      name: 'Staff app',
      family: 'sans',
      styles: [
        face('app-jumbo', 700, 56, 62, -1.5, { sample: '20%', usage: "A notice's discount." }),
        face('app-hero', 700, 40, 46, -1, {
          sample: '12',
          usage: 'The quantity typed on the keypad.',
        }),
        face('app-display', 700, 32, 38, -0.8, {
          sample: '12,000,000₮',
          usage: "The month's total on the home card.",
        }),
        face('app-large-title', 700, 28, 34, -0.5, {
          sample: 'Бараа',
          usage: "A screen's large title.",
        }),
        face('app-title', 700, 24, 30, -0.4, { sample: 'Бараа', usage: 'A title.' }),
        face('app-title2', 700, 22, 28, -0.3, { sample: 'Бараа', usage: 'A smaller title.' }),
        face('app-title3', 700, 19, 24, -0.2, { sample: 'Бараа', usage: 'A smaller title.' }),
        face('app-wordmark', 700, 22, 26, -0.6, {
          sample: 'Bto',
          usage: '«Bto» next to the logo.',
        }),
        face('app-section-title', 700, 17, 22, -0.2, {
          sample: 'Шинэ бараа',
          usage: "A section's title with a «Бүгд» link.",
        }),
        face('app-heading', 600, 16, 21, -0.1, { sample: 'Хүлээн авах', usage: 'A heading.' }),
        face('app-row', 400, 15, 20, -0.1, { sample: 'Хүлээн авах', usage: 'A list row.' }),
        face('app-row-strong', 600, 15, 20, -0.1, {
          sample: 'Хүлээн авах',
          usage: "A list row's name.",
        }),
        face('app-field', 400, 16, 20, 0, { sample: 'Хайх', usage: 'Text typed into a field.' }),
        face('app-button', 600, 16, 20, -0.1, { sample: 'Хадгалах', usage: "A button's label." }),
        face('app-body', 400, 14, 19, 0, { sample: 'Хүлээн авах', usage: 'Body text.' }),
        face('app-body-strong', 600, 14, 19, 0, {
          sample: 'Хүлээн авах',
          usage: 'Strong body text.',
        }),
        face('app-chip', 500, 13, 18, 0, { sample: 'Бүгд', usage: 'A chip.' }),
        face('app-label', 600, 13, 16, 0, {
          sample: 'Нэр',
          usage: "A field's label above its box, app-label2.",
        }),
        face('app-secondary', 400, 12, 16, 0, {
          sample: 'Өнөөдөр',
          usage: 'Secondary lines, app-muted.',
        }),
        face('app-section-header', 600, 12, 16, 0.1, {
          sample: 'Өнөөдөр',
          usage: "A section's header, app-muted.",
        }),
        face('app-caption', 400, 11, 14, 0.1, {
          sample: 'Өнөөдөр',
          usage: 'A caption, app-muted.',
        }),
        face('app-badge', 700, 10, 12, 0, { sample: '3', usage: 'A small badge, white.' }),
        face('app-tab', 600, 10, 12, 0, { sample: 'Нүүр', usage: 'A tab bar label.' }),
      ],
    },
    {
      name: 'Bto300',
      family: 'sans',
      styles: [
        face('store-wordmark', 700, 20, 24, -0.5, {
          sample: 'Bto300',
          usage: '«Bto300» on the blue header, white.',
        }),
        face('store-header-title', 400, 17, 22, 0, {
          sample: 'Мэдэгдэл',
          usage: "The blue header's title, white.",
        }),
        face('store-header-button', 500, 15, 20, 0, {
          sample: 'Засах',
          usage: 'A button on the header, white.',
        }),
        face('store-header-link', 500, 14, 20, 0.2, {
          sample: 'АНГИЛАЛ',
          usage: "The home's quick links on the header, upper case, white.",
        }),
        face('store-search', 400, 14, 18, 0, {
          sample: 'Хайх',
          usage: 'The search box, app-muted.',
        }),
        face('store-heading', 400, 17, 22, 0.2, {
          sample: 'АНГИЛЛЫН ЖАГСААЛТ',
          usage: "The home's headings, upper case.",
        }),
        face('store-section-title', 400, 16, 21, 0.2, {
          sample: 'ШИНЭ БАРАА',
          usage: "A section's title, upper case.",
        }),
        face('store-section-sub', 400, 13, 17, 0, {
          sample: 'Бүгд',
          usage: "A section's second line, app-muted.",
        }),
        face('store-tile', 400, 13, 17, 0, { sample: 'Ундаа', usage: 'A category tile.' }),
        face('store-card-name', 400, 15, 20, 0, {
          sample: 'Ундаа',
          usage: "A product card's name.",
        }),
        face('store-card-pack', 400, 13, 17, 0, {
          sample: '1 хайрцаг',
          usage: "A product card's pack, app-muted.",
        }),
        face('store-card-price', 500, 16, 21, 0, {
          sample: '12,000₮',
          usage: "A product card's price.",
        }),
        face('store-card-old', 400, 12, 16, 0, {
          sample: '14,000₮',
          usage: 'The old price, app-muted.',
        }),
        face('store-card-stock', 600, 12, 16, 0, {
          sample: 'Байна',
          usage: "A product card's stock line.",
        }),
        face('store-badge', 700, 12, 16, 0.2, {
          sample: 'Шинэ',
          usage: 'A deal badge, white on its colour.',
        }),
        face('store-tab', 500, 11, 13, 0, {
          sample: 'Нүүр',
          usage: 'The flat tab bar, app-placeholder when idle.',
        }),
        face('store-pill', 500, 15, 20, 0, {
          sample: 'Сагс',
          usage: 'The floating blue pill, white.',
        }),
        face('store-wide-button', 600, 14, 18, 0.3, {
          sample: 'АНГИЛЛЫН БҮХ БАРАА · 86',
          usage: 'The grey full-width button, upper case, app-label2.',
        }),
        face('store-tab-button', 500, 15, 20, 0, {
          sample: 'Мэдэгдэл',
          usage: "«Мэдэгдэл»'s two tab buttons.",
        }),
        face('store-table-head', 600, 11, 14, 0.2, {
          sample: 'ОГНОО',
          usage: '«Тооцооны хуулга»: column heads, upper case, app-muted.',
        }),
        face('store-table-cell', 400, 13, 18, 0, {
          sample: '2026-11-01',
          usage: '«Тооцооны хуулга»: a cell.',
        }),
        face('store-table-cell-strong', 600, 13, 18, 0, {
          sample: '12,000₮',
          usage: '«Тооцооны хуулга»: a strong cell.',
        }),
        face('store-table-total', 700, 14, 18, 0, {
          sample: '12,000₮',
          usage: "«Эцсийн үлдэгдэл» at the table's foot, primary (4.7:1 on white).",
        }),
      ],
    },
  ],
};

const t = (name, value, usage) => ({ name, value, usage });

const spacing = {
  note: 'Tailwind steps (0.25rem base) the kit really uses, at a 16px root; the root scale grows them with the window. There is no other spacing scale in the source.',
  tokens: [
    t(
      'space-0.5',
      '0.125rem',
      "gap-0.5: row actions, top bar modules, a segmented control's track padding.",
    ),
    t('space-1', '0.25rem', 'gap-1: tabs, breadcrumb items, menu padding.'),
    t(
      'space-1.5',
      '0.375rem',
      'gap-1.5: a label over its field, a field over its hint; table cell block padding; menu items.',
    ),
    t(
      'space-2',
      '0.5rem',
      'gap-2: filter pills, header actions, button icon to label, footer buttons.',
    ),
    t('space-2.5', '0.625rem', "py-2.5: FieldList rows, alerts; the empty state's gap."),
    t(
      'space-3',
      '0.75rem',
      'mb-3 under the filter bar; table cell inline padding; small card padding; field inline padding.',
    ),
    t(
      'space-3.5',
      '0.875rem',
      "px-3.5: FormRow, FieldList and alerts; a segment's and a small button's inline padding.",
    ),
    t(
      'space-4',
      '1rem',
      "Card padding, mb-4 under PageHeader, the page's side padding on a phone, the first and last table cell.",
    ),
    t('space-5', '1.25rem', 'Dialog and sheet padding; the page starts this far below the bar.'),
    t('space-8', '2rem', "The page's side padding from md."),
    t('space-10', '2.5rem', "pb-10 under the page; the empty state's block padding."),
    t('app-space-xs', '4px', 'Phone apps: the smallest gap.'),
    t('app-space-sm', '8px', 'Phone apps: chips and rows.'),
    t('app-space-md', '12px', 'Phone apps: inside cards.'),
    t('app-space-lg', '16px', "Phone apps: the screen's side padding."),
    t('app-space-xl', '24px', 'Phone apps: between sections.'),
    t('app-space-xxl', '32px', 'Phone apps: large gaps.'),
  ],
};

const radius = {
  note: 'index.css derives sm to 2xl from --radius with calc(); the values here are those results at a 16px root. Written in px, they do not follow a token edit of radius.',
  tokens: [
    t('radius', '0.875rem', 'The base (since 2026-10-30): cards.'),
    t(
      'radius-tiny',
      '0.25rem',
      "Tailwind's plain rounded: skeleton bars, a kbd, a focused link's outline.",
    ),
    t('radius-checkbox', '5px', 'A checkbox (rounded-[5px]).'),
    t('radius-sm', '8px', 'calc(var(--radius) - 6px).'),
    t('radius-md', '12px', 'calc(var(--radius) - 2px): menu items, select items.'),
    t(
      'radius-lg',
      '12px',
      "calc(var(--radius) - 2px): fields, selects, fact chips, totals tiles, the top bar's mark.",
    ),
    t(
      'radius-xl',
      '14px',
      'var(--radius): cards, list cards, alerts, menus, FormSection boxes, home tiles, the large mark.',
    ),
    t('radius-2xl', '18px', 'calc(var(--radius) + 4px): dialogs and StickyActions.'),
    t(
      'radius-full',
      '9999px',
      "EVERY button, filter pill, segmented control, badge, switch and toast: the capsule, the owner's choice of Apple's newer look.",
    ),
    t('app-radius-icon-tile', '8px', 'Phone apps: a 30 px tinted icon square.'),
    t('app-radius-control', '10px', 'Phone apps: controls.'),
    t('app-radius-field', '12px', 'Phone apps: fields.'),
    t('app-radius-card', '18px', 'Phone apps: inset grouped lists and cards.'),
    t('app-radius-tile', '22px', 'Phone apps: a product picture in the grid.'),
    t('app-radius-hero', '28px', "Phone apps: the product page's picture."),
    t('app-radius-sheet', '30px', "Phone apps: a sheet's top corners."),
    t('app-radius-pill', '999px', 'Phone apps: pills.'),
  ],
};

const shadow = {
  note: 'Faint on purpose. Cards pair shadow-card with the hairline-ring.',
  tokens: [
    t('shadow-card', '0 1px 2px rgb(0 0 0 / 0.04)', 'Cards, list cards and tiles at rest.'),
    t(
      'shadow-control',
      '0 1px 1px rgb(0 0 0 / 0.05)',
      'Buttons, fields, filter pills, the selected segment.',
    ),
    t(
      'shadow-popover',
      '0 10px 30px -8px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.06)',
      'Menus, calendars, toasts, floating bars, a tile under the pointer.',
    ),
    t(
      'shadow-dialog',
      '0 24px 64px -16px rgb(0 0 0 / 0.3), 0 4px 12px rgb(0 0 0 / 0.08)',
      "Dialogs, sheets and the till's centred card.",
    ),
    t(
      'shadow-thumb',
      '0 1px 3px rgb(0 0 0 / 0.25)',
      "A switch's thumb (a literal in ui/switch.tsx).",
    ),
    t(
      'app-shadow-floating',
      '0 1px 2px rgba(0,0,0,0.05), 0 6px 18px rgba(0,0,0,0.08)',
      'Phone apps: floating elements.',
    ),
    t(
      'app-shadow-tab-bar',
      '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.10)',
      'Staff app: the floating tab bar.',
    ),
    t('app-shadow-brand', '0 6px 16px rgba(0,113,227,0.28)', 'Staff app: the logo tile.'),
    t(
      'app-shadow-accent-card',
      '0 6px 18px rgba(0,113,227,0.22)',
      'Staff app: the blue month card.',
    ),
    t(
      'app-shadow-capsule',
      '0 1px 3px rgba(0,0,0,0.18)',
      'Phone apps: a pager capsule over a picture.',
    ),
    t('app-shadow-add-button', '0 2px 10px rgba(0,0,0,0.14)', 'Phone apps: the round add button.'),
    t(
      'app-shadow-segment',
      '0 3px 8px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)',
      'Phone apps: the selected segment.',
    ),
    t('app-shadow-stepper', '0 1px 3px rgba(0,0,0,0.1)', 'Phone apps: the stepper.'),
    t('app-shadow-hero', '0 4px 14px rgba(0,0,0,0.1)', 'Phone apps: the product picture.'),
    t(
      'app-shadow-knob',
      '0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.06)',
      "Phone apps: a switch's knob.",
    ),
    t('app-shadow-popup', '0 20px 60px rgba(0,0,0,0.25)', 'Phone apps: a popup.'),
    t('app-shadow-toast', '0 10px 30px rgba(0,0,0,0.14)', 'Phone apps: a toast.'),
    t('app-shadow-key', '0 1px 0 rgba(0,0,0,0.3)', 'Staff app: a key on the keypad.'),
    t(
      'app-shadow-scan-button',
      '0 4px 12px rgba(0,113,227,0.35)',
      'Bto300: the raised barcode button.',
    ),
    t('app-shadow-blue-pill', '0 8px 24px rgba(0,113,227,0.3)', 'Bto300: the floating blue pill.'),
  ],
};

const controlSize = {
  note: 'Heights and icon sizes from the components, at a 16px root.',
  tokens: [
    t('control-h', '2.5rem', 'h-10: fields, selects, the default button, icon buttons.'),
    t(
      'control-h-lg',
      '2.75rem',
      'h-11: a large button, every button a cashier presses (44px or more).',
    ),
    t('control-h-sm', '2.125rem', 'h-8.5: small buttons, filter pills, the list search.'),
    t('control-h-xs', '1.625rem', "h-6.5: extra-small buttons, a chip's clear button."),
    t('segment-h', '1.875rem', 'h-7.5: a segment.'),
    t('tab-h', '2.25rem', 'h-9: a tab.'),
    t('badge-h', '1.375rem', 'h-5.5: a status pill.'),
    t('row-h', '2.25rem', 'h-9: a table row.'),
    t('row-head-h', '2rem', 'h-8: a table head.'),
    t('row-action', '1.75rem', "size-7: a row's icon button."),
    t('topbar-h', '3.25rem', 'h-13: the sticky top bar.'),
    t('switch-w', '38px', "A switch's width."),
    t('switch-h', '22px', "A switch's height."),
    t('switch-thumb', '1.125rem', "A switch's thumb."),
    t('checkbox-size', '1rem', 'A checkbox, with a larger hit area around it.'),
    t('mark-topbar', '1.75rem', 'size-7: the brand mark in the top bar.'),
    t('mark-large', '2.5rem', 'size-10: the brand mark on the till and the sign-in pages.'),
    t('tile-min-h', '3.5rem', "min-h-14: a module page's tile."),
    t('icon-size', '1rem', 'size-4: the icon in a default button, a row or a menu item.'),
    t('icon-size-sm', '0.875rem', 'size-3.5: the icon in a small button.'),
    t('icon-size-xs', '0.75rem', 'size-3: the icon in an extra-small button or a badge.'),
    t(
      'touch-min',
      '44px',
      'The smallest touch target on the phone and the till (TOUCH in tokens.ts).',
    ),
  ],
};

const layoutWidth = {
  note: 'The widths a page, a dialog or a panel may take; a one-off width is a mistake.',
  tokens: [
    t('dialog-sm', '28rem', 'DialogContent size sm: a question, up to 3 fields.'),
    t('dialog-md', '32rem', 'DialogContent size md: a one-column form.'),
    t('dialog-lg', '42rem', 'DialogContent size lg: two columns or a small table.'),
    t('dialog-xl', '56rem', 'DialogContent size xl: a line editor.'),
    t('sheet-default', '36rem', 'A plain Sheet from the side.'),
    t(
      'sheet-record',
      '64rem',
      'RecordSheet size record: finance and the supermarket, part of the list stays in view at 1366.',
    ),
    t(
      'sheet-panel',
      '80rem',
      'RecordSheet size panel: a record people work in, like the sales order.',
    ),
    t('side-column', '26rem', "A record's side column from xl."),
    t('form-label', '11rem', 'The label column of FormRow and FieldList.'),
    t('side-panel', '15rem', 'w-60: the folding left panel of a work page.'),
    t('board-column', '18rem', "w-72: a board's stage column; the list search from sm."),
    t('menu-min', '12rem', 'A dropdown menu at its narrowest.'),
    t('menu-max', '22rem', 'A dropdown menu at its widest.'),
  ],
};

const rootFontSize = {
  note: 'Everything is sized in rem, so the whole screen grows with the window (html[data-app="web"] in index.css).',
  tokens: [
    t(
      'root-base',
      '16px',
      'The till (pos.html) and paper. Every size in this system is quoted at this root.',
    ),
    t('root-app', '17px', 'The main app below 1600px wide.'),
    t('root-app-1600', '18px', 'The main app from 1600px wide.'),
    t('root-app-1900', '19px', 'The main app from 1900px wide.'),
  ],
};

const tokens = {
  name: 'Bto',
  version: 1,
  meta: {
    source: 'github',
    repo: 'ez4puljin/Bto',
    ref: rev.ref,
    paths: {
      tokens: ['apps/web/src/index.css', 'apps/mobile/src/theme/tokens.ts'],
      fonts: ['node_modules/@fontsource-variable/inter/files'],
      assets: ['apps/mobile/assets', 'node_modules/lucide-react'],
      docs: ['docs/ui.md'],
    },
    components: {
      Button: 'apps/web/src/components/ui/button.tsx',
      Badge: 'apps/web/src/components/ui/badge.tsx',
      Card: 'apps/web/src/components/ui/card.tsx',
      PageHeader: 'apps/web/src/components/page-header.tsx',
      ListCard: 'apps/web/src/components/list.tsx',
      FormSection: 'apps/web/src/components/form.tsx',
      DetailCard: 'apps/web/src/components/detail.tsx',
      Sheet: 'apps/web/src/components/record-sheet.tsx',
    },
    synced: rev.date,
  },
  color: { themes: [{ id: 'light', name: 'Light' }], tokens: color },
  type,
  spacing,
  radius,
  shadow,
  controlSize,
  layoutWidth,
  rootFontSize,
};

syncColors(color, c);

// Checks the page's grammar would otherwise drop silently.
const seen = new Set();
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
for (const [family, list] of [
  ['color', color],
  ['spacing', spacing.tokens],
  ['radius', radius.tokens],
  ['shadow', shadow.tokens],
  ['controlSize', controlSize.tokens],
  ['layoutWidth', layoutWidth.tokens],
  ['rootFontSize', rootFontSize.tokens],
]) {
  if (list.length > (family === 'color' ? 600 : 60))
    throw new Error(`${family}: too many (${list.length})`);
  for (const token of list) {
    if (!NAME.test(token.name)) throw new Error(`bad name ${token.name}`);
    if (seen.has(token.name)) throw new Error(`duplicate ${token.name}`);
    seen.add(token.name);
    if (!token.usage) throw new Error(`no usage ${token.name}`);
  }
}
const styles = type.groups.flatMap((g) => g.styles);
if (styles.length > 80) throw new Error(`styles ${styles.length}`);
const styleNames = new Set();
for (const style of styles) {
  if (!NAME.test(style.name) || styleNames.has(style.name)) throw new Error(`style ${style.name}`);
  styleNames.add(style.name);
  if (!style.usage) throw new Error(`no usage ${style.name}`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(tokens, null, 2) + '\n');
console.log(
  `tokens.json: ${color.length} colours, ${styles.length} styles, ${spacing.tokens.length} spacing, ${radius.tokens.length} radii, ${shadow.tokens.length} shadows, ${controlSize.tokens.length} sizes, ${layoutWidth.tokens.length} widths`,
);
