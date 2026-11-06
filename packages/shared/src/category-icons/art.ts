/** The soft two-tone tiles behind the drawings. */
const TILES = {
  amber: ['#FEF3C7', '#FDE68A'],
  orange: ['#FFEDD5', '#FED7AA'],
  red: ['#FEE2E2', '#FECACA'],
  rose: ['#FFE4E6', '#FECDD3'],
  pink: ['#FCE7F3', '#FBCFE8'],
  violet: ['#EDE9FE', '#DDD6FE'],
  indigo: ['#E0E7FF', '#C7D2FE'],
  blue: ['#DBEAFE', '#BFDBFE'],
  sky: ['#E0F2FE', '#BAE6FD'],
  cyan: ['#CFFAFE', '#A5F3FC'],
  teal: ['#CCFBF1', '#99F6E4'],
  green: ['#DCFCE7', '#BBF7D0'],
  lime: ['#ECFCCB', '#D9F99D'],
  slate: ['#E2E8F0', '#CBD5E1'],
} as const;

type Tile = keyof typeof TILES;

/**
 * The drawings on a 64×64 canvas, flat shapes in a few bright colours, one per kind of goods (the
 * owner, 2026-11-06: «өнгөлөг гоёмсог»). Plain SVG shapes only: the web shows them as an image and
 * the phones through `react-native-svg`.
 */
const ART = {
  // Drinks.
  drinks: [
    'sky',
    '<path d="M21 13h8v6c0 2.5 4 4 4 9v23a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V28c0-5 4-6.5 4-9z" fill="#38BDF8"/><rect x="20" y="9" width="10" height="6" rx="1.5" fill="#2563EB"/><rect x="17" y="31" width="16" height="12" fill="#fff"/><path d="M38 29h14l-2 22.5a2.5 2.5 0 0 1-2.5 2.5h-5a2.5 2.5 0 0 1-2.5-2.5z" fill="#FB923C"/><path d="M38 29h14l-.6 6H38.6z" fill="#FED7AA"/><path d="M46 29l3.5-14 2.5.7L48.7 29z" fill="#EF4444"/>',
  ],
  wine: [
    'rose',
    '<path d="M19 9h7v10c0 2 4 4 4 8v25a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V27c0-4 4-6 4-8z" fill="#7F1D1D"/><rect x="19" y="9" width="7" height="7" rx="1" fill="#F59E0B"/><rect x="15" y="32" width="15" height="13" fill="#FEF3C7"/><rect x="19" y="36" width="7" height="2" fill="#B91C1C"/><path d="M36 22h17c0 10-3.5 16-8.5 16S36 32 36 22z" fill="#fff" opacity=".85"/><path d="M36.5 27h16c-.8 7-4 11-8 11s-7.2-4-8-11z" fill="#DC2626"/><rect x="43.5" y="38" width="2" height="13" fill="#94A3B8"/><rect x="38" y="51" width="13" height="3" rx="1.5" fill="#64748B"/>',
  ],
  vodka: [
    'blue',
    '<path d="M27 8h10v12c0 2.5 5 3.5 5 9v24a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V29c0-5.5 5-6.5 5-9z" fill="#F0F9FF"/><rect x="26.5" y="7" width="11" height="7" rx="1.5" fill="#DC2626"/><rect x="22" y="31" width="20" height="15" fill="#1D4ED8"/><path d="M32 33.5l1.5 3.2 3.5.5-2.5 2.4.6 3.5-3.1-1.7-3.1 1.7.6-3.5-2.5-2.4 3.5-.5z" fill="#FDE68A"/>',
  ],
  beer: [
    'amber',
    '<rect x="14" y="22" width="28" height="33" rx="4" fill="#F59E0B"/><path d="M42 28h4a7 7 0 0 1 7 7v7a7 7 0 0 1-7 7h-4v-5h3.5a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H42z" fill="#D97706"/><rect x="20" y="31" width="3" height="18" rx="1.5" fill="#FDE68A"/><rect x="27" y="31" width="3" height="18" rx="1.5" fill="#FDE68A"/><rect x="34" y="31" width="3" height="18" rx="1.5" fill="#FDE68A"/><circle cx="19" cy="19" r="7" fill="#fff"/><circle cx="28" cy="15" r="8" fill="#fff"/><circle cx="38" cy="19" r="7" fill="#fff"/><rect x="14" y="19" width="28" height="7" rx="3" fill="#fff"/>',
  ],
  water: [
    'cyan',
    '<path d="M32 8c8.5 11.5 16 19.5 16 29a16 16 0 0 1-32 0c0-9.5 7.5-17.5 16-29z" fill="#0EA5E9"/><path d="M32 18c5.5 7.5 11 13 11 20a11 11 0 0 1-22 0c0-7 5.5-12.5 11-20z" fill="#38BDF8"/><path d="M25 38a7.5 7.5 0 0 0 7.5 7.5" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none"/>',
  ],
  energy: [
    'indigo',
    '<rect x="19" y="12" width="26" height="41" rx="5" fill="#1E293B"/><rect x="21" y="8" width="22" height="6" rx="2" fill="#94A3B8"/><rect x="21" y="51" width="22" height="5" rx="2" fill="#94A3B8"/><path d="M36 17L24 35h7l-2.5 13L41 29h-7.5z" fill="#FACC15"/>',
  ],
  soda: [
    'red',
    '<path d="M18 23h28l-3 29.5a3 3 0 0 1-3 2.5H24a3 3 0 0 1-3-2.5z" fill="#EF4444"/><rect x="15" y="17" width="34" height="7" rx="3.5" fill="#fff"/><path d="M36 17l3.5-11 4 1.2L40 17z" fill="#F59E0B"/><circle cx="27" cy="33" r="3" fill="#FCA5A5"/><circle cx="37" cy="38" r="2.5" fill="#FCA5A5"/><circle cx="29" cy="45" r="2" fill="#FCA5A5"/>',
  ],
  tetra: [
    'green',
    '<path d="M18 22l14-9 14 9v31a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2z" fill="#22C55E"/><path d="M18 22l14-9 14 9z" fill="#86EFAC"/><rect x="18" y="29" width="28" height="16" fill="#fff"/><circle cx="32" cy="37" r="6" fill="#F97316"/><path d="M38 16l3-10 3 1-3 11z" fill="#EF4444"/>',
  ],
  juice: [
    'orange',
    '<path d="M16 20h28l-3 32a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3z" fill="#fff" opacity=".8"/><path d="M17 28h26l-2.3 24a3 3 0 0 1-3 3H22.3a3 3 0 0 1-3-3z" fill="#F97316"/><path d="M27 21L24 8l3-.8L31 21z" fill="#EF4444"/><circle cx="44" cy="20" r="10" fill="#F97316"/><circle cx="44" cy="20" r="7.5" fill="#FFEDD5"/><path d="M44 12.5v15M36.5 20h15M38.7 14.7l10.6 10.6M38.7 25.3l10.6-10.6" stroke="#FB923C" stroke-width="1.8"/>',
  ],
  // Sweets.
  sweets: [
    'pink',
    '<path d="M18 34h28l-4 19a2.5 2.5 0 0 1-2.5 2H24.5a2.5 2.5 0 0 1-2.5-2z" fill="#EC4899"/><path d="M25 34l2 21M32 34v21M39 34l-2 21" stroke="#FBCFE8" stroke-width="2"/><path d="M14 35c-1.5-6 3.5-9.5 7-9.5C21 19 26 15 32 15s11 4 11 10.5c3.5 0 8.5 3.5 7 9.5z" fill="#FEF3C7"/><circle cx="32" cy="13" r="5" fill="#EF4444"/><path d="M32 8c1-2 3-3 5-3" stroke="#15803D" stroke-width="2" fill="none" stroke-linecap="round"/>',
  ],
  gum: [
    'teal',
    '<rect x="11" y="22" width="42" height="26" rx="3" fill="#14B8A6"/><rect x="11" y="29" width="42" height="12" fill="#CCFBF1"/><path d="M21 29v12M29 29v12M37 29v12M45 29v12" stroke="#5EEAD4" stroke-width="1.5"/><path d="M26 10c7-1 12 2 13 9-7 2-13-1-13-9z" fill="#22C55E"/><path d="M28 12c3 2 6 4 9 6.5" stroke="#15803D" stroke-width="1.3" fill="none"/>',
  ],
  wafer: [
    'amber',
    '<g transform="rotate(-10 32 32)"><rect x="10" y="19" width="44" height="11" rx="2" fill="#F59E0B"/><rect x="10" y="30" width="44" height="5" fill="#78350F"/><rect x="10" y="35" width="44" height="11" rx="2" fill="#F59E0B"/><path d="M18 19v11M26 19v11M34 19v11M42 19v11M50 19v11M18 35v11M26 35v11M34 35v11M42 35v11M50 35v11M10 24.5h44M10 40.5h44" stroke="#B45309" stroke-width="1.4"/></g>',
  ],
  giftBox: [
    'violet',
    '<rect x="13" y="29" width="38" height="26" rx="3" fill="#8B5CF6"/><rect x="10" y="21" width="44" height="10" rx="2.5" fill="#A78BFA"/><rect x="28" y="21" width="8" height="34" fill="#FACC15"/><path d="M32 21c-4-10-14-13-16-6-1.5 6 9 7 16 6zM32 21c4-10 14-13 16-6 1.5 6-9 7-16 6z" fill="#FACC15"/>',
  ],
  cookie: [
    'orange',
    '<circle cx="32" cy="32" r="22" fill="#B45309"/><circle cx="32" cy="31" r="20" fill="#D97706"/><circle cx="24" cy="23" r="3.8" fill="#451A03"/><circle cx="39" cy="21" r="3.2" fill="#451A03"/><circle cx="43" cy="36" r="3.8" fill="#451A03"/><circle cx="29" cy="40" r="3.4" fill="#451A03"/><circle cx="19" cy="35" r="2.4" fill="#451A03"/><circle cx="34" cy="30" r="2.4" fill="#451A03"/>',
  ],
  lollipop: [
    'rose',
    '<rect x="30" y="36" width="4" height="23" rx="2" fill="#fff"/><circle cx="32" cy="24" r="17" fill="#F43F5E"/><path d="M32 24c2.5-2 6.5 0 5.5 4-1.2 5-11 5-13-1.5-2-7.5 4.5-14 11.5-13 6.5 1 10.5 6.5 9.5 13" fill="none" stroke="#FECDD3" stroke-width="3.2" stroke-linecap="round"/>',
  ],
  swissRoll: [
    'orange',
    '<circle cx="32" cy="32" r="22" fill="#78350F"/><circle cx="32" cy="32" r="18" fill="#FEF3C7"/><path d="M32 32c1-3.5 6.5-2.5 6.5 2s-8 7.5-12 3-2-14 5.5-15.5 14.5 6.5 12 14.5" fill="none" stroke="#92400E" stroke-width="4" stroke-linecap="round"/>',
  ],
  cake: [
    'pink',
    '<rect x="9" y="50" width="46" height="5" rx="2.5" fill="#94A3B8"/><rect x="13" y="30" width="38" height="21" rx="3" fill="#F472B6"/><path d="M13 33a5 5 0 0 1 5-5h28a5 5 0 0 1 5 5c0 3.5-3.5 5-6 2.5-1.3 3.5-6 3.5-7.5 0-2 3.5-6.5 3.5-8 0-1.5 3.5-6 3.5-8 0-1.5 3.5-6.2 3.5-7.5 0C16.5 38 13 36.5 13 33z" fill="#fff"/><rect x="30.3" y="17" width="3.4" height="11" rx="1" fill="#38BDF8"/><path d="M32 8c2.3 3 3.5 4.5 3.5 6.5a3.5 3.5 0 0 1-7 0c0-2 1.2-3.5 3.5-6.5z" fill="#F59E0B"/>',
  ],
  candyBag: [
    'pink',
    '<path d="M18 16h28l-1 6 6 28a3 3 0 0 1-3 4H16a3 3 0 0 1-3-4l6-28z" fill="#EC4899"/><rect x="16" y="11" width="32" height="6" rx="1.5" fill="#BE185D"/><circle cx="32" cy="37" r="12" fill="#fff"/><circle cx="27.5" cy="34" r="3.5" fill="#F59E0B"/><circle cx="36.5" cy="33.5" r="3.5" fill="#22C55E"/><circle cx="32" cy="41.5" r="3.5" fill="#3B82F6"/>',
  ],
  nuts: [
    'orange',
    '<path d="M14 31c0 14 8 25 18 25s18-11 18-25z" fill="#B45309"/><path d="M10 31c0-9 10-16 22-16s22 7 22 16c0 2.5-1.5 4-4 4H14c-2.5 0-4-1.5-4-4z" fill="#78350F"/><rect x="29" y="8" width="6" height="10" rx="2" fill="#78350F"/><path d="M21 40c1 5 3 8 6 10" stroke="#FCD34D" stroke-width="3" stroke-linecap="round" fill="none"/>',
  ],
  chips: [
    'amber',
    '<path d="M15 10h34l-2 6 3 32-3 6H17l-3-6 3-32z" fill="#EF4444"/><path d="M15 10h34l-1.3 4H16.3zM17 54h30l1.3-4H15.7z" fill="#B91C1C"/><ellipse cx="32" cy="32" rx="13" ry="11" fill="#FDE047"/><path d="M21 31c3.5-3.5 7 3 11 0s7.5 3 11 0" stroke="#F59E0B" stroke-width="2.2" fill="none"/><path d="M23 37c3-3 6 2.5 9 0s6 2.5 9 0" stroke="#F59E0B" stroke-width="2" fill="none"/>',
  ],
  chocolate: [
    'orange',
    '<rect x="15" y="8" width="34" height="34" rx="3" fill="#78350F"/><rect x="18.5" y="11.5" width="12.5" height="9" rx="1.5" fill="#92400E"/><rect x="33" y="11.5" width="12.5" height="9" rx="1.5" fill="#92400E"/><rect x="18.5" y="23" width="12.5" height="9" rx="1.5" fill="#92400E"/><rect x="33" y="23" width="12.5" height="9" rx="1.5" fill="#92400E"/><path d="M13 36l6.3 3.5 6.3-3.5 6.4 3.5 6.4-3.5 6.3 3.5 6.3-3.5v18a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3z" fill="#DC2626"/><rect x="21" y="45" width="22" height="3" rx="1.5" fill="#FDE68A"/>',
  ],
  gummy: [
    'rose',
    '<g fill="#F43F5E"><circle cx="23.5" cy="10" r="4"/><circle cx="40.5" cy="10" r="4"/><circle cx="32" cy="17" r="10"/><ellipse cx="32" cy="36" rx="13" ry="14"/><ellipse cx="18" cy="31" rx="5" ry="8" transform="rotate(30 18 31)"/><ellipse cx="46" cy="31" rx="5" ry="8" transform="rotate(-30 46 31)"/><ellipse cx="22" cy="51" rx="7" ry="5.5"/><ellipse cx="42" cy="51" rx="7" ry="5.5"/></g><ellipse cx="27" cy="33" rx="3" ry="6.5" fill="#FDA4AF"/><circle cx="28.5" cy="15.5" r="1.5" fill="#881337"/><circle cx="35.5" cy="15.5" r="1.5" fill="#881337"/>',
  ],
  candyBox: [
    'indigo',
    '<rect x="9" y="17" width="46" height="34" rx="3" fill="#6366F1"/><rect x="15" y="23" width="34" height="22" rx="2" fill="#fff"/><circle cx="23.5" cy="34" r="4.5" fill="#F43F5E"/><circle cx="32" cy="34" r="4.5" fill="#F59E0B"/><circle cx="40.5" cy="34" r="4.5" fill="#22C55E"/><path d="M15 23l10 0-10 10z" fill="#E0E7FF"/>',
  ],
  candy: [
    'violet',
    '<path d="M20 32L7 21c-1-1-3 0-3 1.5v19c0 1.5 2 2.5 3 1.5zM44 32l13-11c1-1 3 0 3 1.5v19c0 1.5-2 2.5-3 1.5z" fill="#A78BFA"/><circle cx="32" cy="32" r="14" fill="#7C3AED"/><path d="M26 22c4 6 4 14 0 20M32 19c4 8 4 18 0 26M38 22c4 6 4 14 0 20" stroke="#fff" stroke-width="2.2" fill="none" opacity=".85"/>',
  ],
  // Dairy.
  dairy: [
    'blue',
    '<path d="M18 23l8-11h12l8 11v29a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" fill="#fff"/><path d="M18 23l8-11h12l8 11z" fill="#93C5FD"/><rect x="25" y="8" width="14" height="5" rx="1" fill="#3B82F6"/><path d="M18 37c5-4 9.5 3 14 0s9-4 14 0v15a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" fill="#3B82F6"/>',
  ],
  milk: [
    'sky',
    '<path d="M26 11h12v7c0 3 5.5 5 5.5 10v24a3 3 0 0 1-3 3h-17a3 3 0 0 1-3-3V28c0-5 5.5-7 5.5-10z" fill="#fff"/><rect x="25" y="7" width="14" height="6" rx="1.5" fill="#2563EB"/><rect x="20.5" y="31" width="23" height="12" fill="#60A5FA"/><path d="M32 33c2 2.5 3.3 4 3.3 5.5a3.3 3.3 0 0 1-6.6 0c0-1.5 1.3-3 3.3-5.5z" fill="#fff"/>',
  ],
  yogurt: [
    'pink',
    '<path d="M15 25h34l-4 27a3 3 0 0 1-3 2.5H22a3 3 0 0 1-3-2.5z" fill="#fff"/><rect x="11" y="19" width="42" height="7" rx="3.5" fill="#EC4899"/><path d="M32 33c5-3 9 0 9 4 0 5-5 10-9 12-4-2-9-7-9-12 0-4 4-7 9-4z" fill="#EF4444"/><path d="M29 31c1-2 2-3 3-3s2 1 3 3c-2 1-4 1-6 0z" fill="#22C55E"/><circle cx="29" cy="39" r=".9" fill="#FDE68A"/><circle cx="35" cy="39" r=".9" fill="#FDE68A"/><circle cx="32" cy="44" r=".9" fill="#FDE68A"/>',
  ],
  tarag: [
    'cyan',
    '<path d="M8 30h48c0 15-10 25-24 25S8 45 8 30z" fill="#0EA5E9"/><path d="M12 40c10 5 30 5 40 0" stroke="#7DD3FC" stroke-width="2.5" fill="none"/><ellipse cx="32" cy="30" rx="24" ry="7" fill="#fff"/><path d="M40 27L51 9l3.5 2L44 29z" fill="#F59E0B"/>',
  ],
  cheese: [
    'amber',
    '<path d="M8 36L43 15c7 2 13 9 13 21z" fill="#FDE047"/><path d="M8 36h48v16a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#FACC15"/><circle cx="22" cy="45" r="4.5" fill="#CA8A04"/><circle cx="39" cy="43" r="3.2" fill="#CA8A04"/><circle cx="48" cy="49" r="2.2" fill="#CA8A04"/><circle cx="38" cy="28" r="3" fill="#EAB308"/>',
  ],
  butter: [
    'lime',
    '<ellipse cx="32" cy="47" rx="27" ry="8" fill="#fff"/><ellipse cx="32" cy="45.5" rx="22" ry="5.5" fill="#E2E8F0"/><path d="M12 27l12-11h29L41 27z" fill="#FEF08A"/><path d="M12 27h29v17H12z" fill="#FDE047"/><path d="M41 27l12-11v16L41 44z" fill="#EAB308"/><path d="M19 27v8M26 27v5" stroke="#FEF9C3" stroke-width="2" stroke-linecap="round"/>',
  ],
  // Seasonings and jars.
  condiment: [
    'red',
    '<path d="M47 14c-1.5 8-7 10-12.5 13.5C28 32 22 41 11 45c11 4 26 0 33-10 5-7 6-15 6-19z" fill="#EF4444"/><path d="M42 21c-1 3-4 5-7 7" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M46 16c0-5 2.5-8 7-9.5l1.5 3.5c-3 1-4.5 2.5-4.5 6.5z" fill="#16A34A"/>',
  ],
  salt: [
    'slate',
    '<path d="M21 26h22l3 26a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" fill="#fff"/><path d="M21 26c0-9 4.5-15 11-15s11 6 11 15z" fill="#64748B"/><circle cx="27.5" cy="19" r="1.5" fill="#fff"/><circle cx="32" cy="16" r="1.5" fill="#fff"/><circle cx="36.5" cy="19" r="1.5" fill="#fff"/><circle cx="32" cy="22" r="1.5" fill="#fff"/><path d="M19.5 38h25l1.5 14a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" fill="#BAE6FD"/>',
  ],
  spice: [
    'orange',
    '<rect x="18" y="22" width="28" height="33" rx="4" fill="#F97316"/><rect x="20" y="10" width="24" height="13" rx="2.5" fill="#B91C1C"/><path d="M24 10v13M32 10v13M40 10v13" stroke="#FCA5A5" stroke-width="1.5"/><rect x="18" y="30" width="28" height="15" fill="#FFF7ED"/><path d="M31 32c6 0 8 3.5 7 10-6 .5-9.5-3.5-7-10z" fill="#22C55E"/><path d="M26 42c1-3 3-4.5 5-5" stroke="#15803D" stroke-width="1.5" fill="none"/>',
  ],
  mayo: [
    'amber',
    '<rect x="15" y="20" width="34" height="35" rx="7" fill="#fff"/><rect x="17" y="10" width="30" height="11" rx="2.5" fill="#2563EB"/><rect x="15" y="29" width="34" height="17" fill="#FDE047"/><path d="M32 31c3.5 0 6 4 6 7.5a6 6 0 0 1-12 0c0-3.5 2.5-7.5 6-7.5z" fill="#fff"/><circle cx="32" cy="39" r="2.5" fill="#F59E0B"/>',
  ],
  pickles: [
    'lime',
    '<rect x="15" y="18" width="34" height="38" rx="6" fill="#fff" opacity=".85"/><rect x="17" y="9" width="30" height="9" rx="2" fill="#EF4444"/><rect x="21" y="24" width="8" height="28" rx="4" fill="#15803D"/><rect x="32" y="29" width="8" height="23" rx="4" fill="#22C55E"/><circle cx="44" cy="46" r="3" fill="#EF4444"/><path d="M24 29v3M24 37v3M24 45v3M36 34v3M36 42v3" stroke="#BBF7D0" stroke-width="1.6" stroke-linecap="round"/>',
  ],
  oil: [
    'lime',
    '<path d="M27 11h10v8c0 3 6.5 5 6.5 11v22a3 3 0 0 1-3 3h-17a3 3 0 0 1-3-3V30c0-6 6.5-8 6.5-11z" fill="#FACC15"/><rect x="26" y="7" width="12" height="6" rx="1.5" fill="#16A34A"/><circle cx="32" cy="39" r="9.5" fill="#FEF9C3"/><g fill="#F59E0B"><circle cx="32" cy="33" r="2.2"/><circle cx="38" cy="39" r="2.2"/><circle cx="32" cy="45" r="2.2"/><circle cx="26" cy="39" r="2.2"/><circle cx="36.2" cy="34.8" r="2.2"/><circle cx="36.2" cy="43.2" r="2.2"/><circle cx="27.8" cy="43.2" r="2.2"/><circle cx="27.8" cy="34.8" r="2.2"/></g><circle cx="32" cy="39" r="3.5" fill="#92400E"/>',
  ],
  ketchup: [
    'red',
    '<path d="M20 27c0-4.5 4-7 9-7h6c5 0 9 2.5 9 7v25a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3z" fill="#DC2626"/><path d="M28 20l1.8-12h4.4L36 20z" fill="#fff"/><rect x="20" y="31" width="24" height="14" fill="#FEF2F2"/><circle cx="32" cy="38.5" r="5.5" fill="#EF4444"/><path d="M29 33.5c2 1 4 1 6 0-1 1.8-2 2.5-3 2.5s-2-.7-3-2.5z" fill="#16A34A"/>',
  ],
  jam: [
    'red',
    '<rect x="14" y="20" width="36" height="35" rx="7" fill="#DC2626"/><path d="M15 21c3-2 3-2 5.7 0s3 0 5.7 0 3-2 5.7 0 3 0 5.7 0 3-2 5.7 0l1.5-9H13.5z" fill="#FDE68A"/><rect x="13" y="19" width="38" height="3" rx="1.5" fill="#F59E0B"/><rect x="20" y="30" width="24" height="17" rx="2" fill="#FFF7ED"/><circle cx="29" cy="39" r="3.5" fill="#EF4444"/><circle cx="35.5" cy="39" r="3.5" fill="#B91C1C"/><path d="M29 35.5c1-2 3-3 5-3" stroke="#16A34A" stroke-width="1.5" fill="none"/>',
  ],
  honey: [
    'amber',
    '<path d="M15 27c0-4 3-7 7-7h20c4 0 7 3 7 7 5 7 5 18 0 24-2 3-5 4-8 4H23c-3 0-6-1-8-4-5-6-5-17 0-24z" fill="#F59E0B"/><rect x="17" y="12" width="30" height="9" rx="3" fill="#FEF3C7"/><path d="M15 27h34c1.5 2.5.5 5.5-2 5.5s-2.5 4.5-5.5 4.5-3-4.5-5.5-4.5-2.5 7-6 7-3.5-7-6-7-3 2-5.5 1-3.5-3.5-3.5-6.5z" fill="#FDE68A"/><path d="M26 46l3-1.8 3 1.8v3.5L29 51.3l-3-1.8zM32 46l3-1.8 3 1.8v3.5L35 51.3l-3-1.8z" fill="#B45309"/>',
  ],
  compote: [
    'orange',
    '<rect x="14" y="17" width="36" height="38" rx="6" fill="#FED7AA"/><rect x="16" y="9" width="32" height="8" rx="2" fill="#94A3B8"/><circle cx="24" cy="29" r="6.5" fill="#F97316"/><circle cx="39" cy="32" r="6.5" fill="#EF4444"/><circle cx="27" cy="45" r="6.5" fill="#FACC15"/><circle cx="41" cy="46" r="4.5" fill="#B91C1C"/><path d="M18 22c-1.2 8-1.2 20 0 28" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".8"/>',
  ],
  condensed: [
    'sky',
    '<rect x="14" y="15" width="36" height="40" rx="4" fill="#2563EB"/><ellipse cx="32" cy="15" rx="18" ry="5.5" fill="#CBD5E1"/><ellipse cx="32" cy="15" rx="14" ry="3.5" fill="#94A3B8"/><path d="M32 25c5.5 7.5 10 10.5 10 16a10 10 0 0 1-20 0c0-5.5 4.5-8.5 10-16z" fill="#fff"/><path d="M27 41a5 5 0 0 0 5 5" stroke="#93C5FD" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  ],
  can: [
    'blue',
    '<rect x="11" y="20" width="42" height="33" rx="4" fill="#EF4444"/><ellipse cx="32" cy="20" rx="21" ry="7" fill="#E2E8F0"/><ellipse cx="32" cy="20" rx="17" ry="5" fill="#94A3B8"/><path d="M38 17.5c4-1.5 7 0 7 2s-3 3-7 2z" fill="#E2E8F0"/><path d="M19 39c6.5-8 15-8 21-1l5-4v11l-5-4c-6 7-14.5 7-21-2z" fill="#fff"/><circle cx="25" cy="38" r="1.5" fill="#1E293B"/>',
  ],
  // Grain.
  wheat: [
    'amber',
    '<path d="M32 59V24" stroke="#B45309" stroke-width="3" stroke-linecap="round"/><g fill="#F59E0B"><ellipse cx="32" cy="13" rx="4.5" ry="8"/><ellipse cx="23.5" cy="23" rx="4.5" ry="8" transform="rotate(-35 23.5 23)"/><ellipse cx="40.5" cy="23" rx="4.5" ry="8" transform="rotate(35 40.5 23)"/><ellipse cx="23.5" cy="35" rx="4.5" ry="8" transform="rotate(-35 23.5 35)"/><ellipse cx="40.5" cy="35" rx="4.5" ry="8" transform="rotate(35 40.5 35)"/><ellipse cx="23.5" cy="47" rx="4.5" ry="8" transform="rotate(-35 23.5 47)"/><ellipse cx="40.5" cy="47" rx="4.5" ry="8" transform="rotate(35 40.5 47)"/></g>',
  ],
  rice: [
    'red',
    '<path d="M8 32h48c0 14-10 23-24 23S8 46 8 32z" fill="#EF4444"/><path d="M12 42c10 5 30 5 40 0" stroke="#FCA5A5" stroke-width="2.5" fill="none"/><path d="M11 32c0-11 9.5-18 21-18s21 7 21 18z" fill="#fff"/><g fill="#CBD5E1"><ellipse cx="22" cy="26" rx="1.2" ry="2.4" transform="rotate(30 22 26)"/><ellipse cx="30" cy="22" rx="1.2" ry="2.4" transform="rotate(-20 30 22)"/><ellipse cx="38" cy="26" rx="1.2" ry="2.4" transform="rotate(40 38 26)"/><ellipse cx="29" cy="29" rx="1.2" ry="2.4" transform="rotate(70 29 29)"/><ellipse cx="44" cy="30" rx="1.2" ry="2.4" transform="rotate(-30 44 30)"/></g><path d="M41 19L55 5M45 21L59 8" stroke="#92400E" stroke-width="2.8" stroke-linecap="round"/>',
  ],
  flour: [
    'orange',
    '<path d="M20 17c-7 8-10 20-10 28 0 7 3 11 10 11h24c7 0 10-4 10-11 0-8-3-20-10-28z" fill="#fff"/><path d="M20 9c3.5 2 8 3 12 3s8.5-1 12-3l1.5 8h-27z" fill="#FDE68A"/><rect x="18" y="15" width="28" height="4.5" rx="2.2" fill="#B45309"/><path d="M32 49V31" stroke="#B45309" stroke-width="2" stroke-linecap="round"/><g fill="#F59E0B"><ellipse cx="32" cy="27" rx="2.4" ry="4.2"/><ellipse cx="27.5" cy="33" rx="2.4" ry="4.2" transform="rotate(-35 27.5 33)"/><ellipse cx="36.5" cy="33" rx="2.4" ry="4.2" transform="rotate(35 36.5 33)"/><ellipse cx="27.5" cy="41" rx="2.4" ry="4.2" transform="rotate(-35 27.5 41)"/><ellipse cx="36.5" cy="41" rx="2.4" ry="4.2" transform="rotate(35 36.5 41)"/></g>',
  ],
  noodles: [
    'orange',
    '<path d="M14 31c0-10 3-13 5.5-13s4 4 4 13M23.5 31c0-13 3-18 6.5-18s6 6 6 18M36 31c0-9 2.5-13 5.5-13s5 4 5 13" fill="none" stroke="#FACC15" stroke-width="3.5"/><path d="M8 30h48c0 15-10 25-24 25S8 45 8 30z" fill="#F97316"/><rect x="6" y="28" width="52" height="5" rx="2.5" fill="#C2410C"/><path d="M26 44c2 2 4 2 6 0s4-2 6 0" stroke="#FFEDD5" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M43 8L57 26M48 6L60 22" stroke="#92400E" stroke-width="2.8" stroke-linecap="round"/>',
  ],
  seaweed: [
    'teal',
    '<path d="M18 58c-7-11 7-15 0-26s5-14 0-24" fill="none" stroke="#15803D" stroke-width="7" stroke-linecap="round"/><path d="M34 58c-7-10 7-15 0-25s5-13 1-20" fill="none" stroke="#16A34A" stroke-width="7" stroke-linecap="round"/><path d="M48 58c-5-9 5-13 0-22s3-8 1-12" fill="none" stroke="#22C55E" stroke-width="6" stroke-linecap="round"/>',
  ],
  // Tea and coffee.
  teaCoffee: [
    'orange',
    '<path d="M10 27h36v13c0 10-8 16-18 16S10 50 10 40z" fill="#B45309"/><path d="M46 31h4a6.5 6.5 0 0 1 0 13h-5" fill="none" stroke="#B45309" stroke-width="4.5"/><ellipse cx="28" cy="27" rx="18" ry="5" fill="#451A03"/><path d="M20 18c-3.5-3 3.5-6 0-10M29 17c-3.5-3 3.5-6 0-10M38 18c-3.5-3 3.5-6 0-10" stroke="#94A3B8" stroke-width="2.8" fill="none" stroke-linecap="round"/>',
  ],
  tea: [
    'lime',
    '<path d="M9 25h38v14c0 10-8 17-19 17S9 49 9 39z" fill="#fff"/><path d="M47 29h3a6.5 6.5 0 0 1 0 13h-4.5" fill="none" stroke="#fff" stroke-width="4.5"/><ellipse cx="28" cy="25" rx="19" ry="5" fill="#65A30D"/><path d="M19 27v12" stroke="#64748B" stroke-width="1.5"/><rect x="14.5" y="39" width="9" height="9" rx="1.5" fill="#22C55E"/><path d="M32 4c8 1 11.5 7 9 15-8-1-12-7-9-15z" fill="#16A34A"/><path d="M34 7c2 3 4 6 5.5 9.5" stroke="#BBF7D0" stroke-width="1.3" fill="none"/>',
  ],
  coffee: [
    'amber',
    '<g transform="rotate(30 23 35)"><ellipse cx="23" cy="35" rx="12" ry="17" fill="#78350F"/><path d="M23 18c-6 7 6 13 0 34" stroke="#D97706" stroke-width="2.6" fill="none"/></g><g transform="rotate(-20 44 27)"><ellipse cx="44" cy="27" rx="11" ry="16" fill="#92400E"/><path d="M44 11c-5 7 5 12 0 32" stroke="#FBBF24" stroke-width="2.4" fill="none"/></g>',
  ],
  sugarCube: [
    'pink',
    '<path d="M24 11l15 7.5-15 7.5L9 18.5z" fill="#fff"/><path d="M9 18.5L24 26v16L9 34.5z" fill="#E2E8F0"/><path d="M39 18.5L24 26v16l15-7.5z" fill="#CBD5E1"/><path d="M42 27l13 6.5L42 40l-13-6.5z" fill="#fff"/><path d="M29 33.5L42 40v14l-13-6.5z" fill="#E2E8F0"/><path d="M55 33.5L42 40v14l13-6.5z" fill="#CBD5E1"/><circle cx="16" cy="48" r="2" fill="#fff"/><circle cx="22" cy="53" r="1.5" fill="#fff"/>',
  ],
  // Meat and meals.
  meat: [
    'red',
    '<path d="M13 21c6.5-9 22-12 32-6 10 5.5 13.5 16.5 8 26-5.5 11-18.5 16-29.5 13-8.5-2.5-10.5-7.5-14-14-3.5-7.5-2-13 3.5-19z" fill="#FECACA"/><path d="M16 23c6-7.5 19.5-10 28.5-5 8.5 4.5 11.5 14 7 22-5 9-16 13.5-25.5 11-7-2-9-6.5-12-12-3-6.5-2-11 2-16z" fill="#EF4444"/><circle cx="25" cy="30" r="6.5" fill="#fff"/><circle cx="25" cy="30" r="2.8" fill="#FECACA"/><path d="M37 21c5 2.5 9.5 6.5 9.5 12M33 44c5 0 9.5-2.5 11.5-5.5" stroke="#FECACA" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  ],
  jerky: [
    'orange',
    '<path d="M10 13c9-3 13.5 2.5 20 0s13-3 24 1l-2.5 8.5c-9.5-3.5-14.5-2.5-20.5 0s-12.5 1.5-19.5-1z" fill="#7F1D1D"/><path d="M10 28c9-3 13.5 2.5 20 0s13-3 24 1l-2.5 8.5c-9.5-3.5-14.5-2.5-20.5 0s-12.5 1.5-19.5-1z" fill="#991B1B"/><path d="M10 43c9-3 13.5 2.5 20 0s13-3 24 1l-2.5 8.5c-9.5-3.5-14.5-2.5-20.5 0s-12.5 1.5-19.5-1z" fill="#B91C1C"/><path d="M18 16c5 0 9 2 14 0M18 31c5 0 9 2 14 0M18 46c5 0 9 2 14 0" stroke="#FCA5A5" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  ],
  sausage: [
    'rose',
    '<rect x="6" y="15" width="44" height="22" rx="11" fill="#DC2626" transform="rotate(-15 28 26)"/><path d="M15 25c6-2 14-4 22-6" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round" fill="none"/><circle cx="43" cy="43" r="14" fill="#DC2626"/><circle cx="43" cy="43" r="11.5" fill="#FDA4AF"/><g fill="#F43F5E"><circle cx="39" cy="39" r="2"/><circle cx="47" cy="40" r="1.6"/><circle cx="42" cy="46" r="1.8"/><circle cx="48" cy="47" r="1.3"/></g><g fill="#fff"><circle cx="43" cy="37" r="1.2"/><circle cx="37" cy="45" r="1.2"/><circle cx="45" cy="50" r="1.2"/></g>',
  ],
  egg: [
    'amber',
    '<path d="M24 11c7 0 13.5 12 13.5 22a13.5 13.5 0 0 1-27 0c0-10 6.5-22 13.5-22z" fill="#D6A25E"/><path d="M20 20c-2.5 3.5-4 8-4 12" stroke="#F3D9B1" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M43 25c6 0 11 9 11 17a11 11 0 0 1-22 0c0-8 5-17 11-17z" fill="#fff"/><path d="M40 32c-2 2.5-3 6-3 9" stroke="#E2E8F0" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  ],
  chicken: [
    'orange',
    '<ellipse cx="41" cy="23" rx="16" ry="14" transform="rotate(-35 41 23)" fill="#D97706"/><ellipse cx="38" cy="19" rx="8" ry="5" transform="rotate(-35 38 19)" fill="#F59E0B"/><path d="M30 34L16 48" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="11" cy="46" r="4.5" fill="#fff"/><circle cx="18" cy="53" r="4.5" fill="#fff"/>',
  ],
  dumpling: [
    'sky',
    '<ellipse cx="32" cy="50" rx="27" ry="7" fill="#3B82F6"/><ellipse cx="32" cy="48" rx="22" ry="4.5" fill="#BFDBFE"/><path d="M11 43c0-14 10-27 21-31 11 4 21 17 21 31 0 4.5-5 6-21 6s-21-1.5-21-6z" fill="#fff"/><path d="M32 12c-3 6-5 12-5 19M32 12c3 6 5 12 5 19M32 12v17M32 12c-6 5-10 12-12 20M32 12c6 5 10 12 12 20" stroke="#FDBA74" stroke-width="2" fill="none" stroke-linecap="round"/>',
  ],
  readyMeal: [
    'sky',
    '<rect x="7" y="24" width="50" height="30" rx="6" fill="#0EA5E9"/><rect x="11" y="28" width="24" height="22" rx="3" fill="#fff"/><g fill="#CBD5E1"><ellipse cx="18" cy="35" rx="1.2" ry="2.2"/><ellipse cx="25" cy="33" rx="1.2" ry="2.2"/><ellipse cx="29" cy="41" rx="1.2" ry="2.2"/><ellipse cx="20" cy="44" rx="1.2" ry="2.2"/></g><rect x="38" y="28" width="15" height="10" rx="2.5" fill="#F97316"/><rect x="38" y="40" width="15" height="10" rx="2.5" fill="#84CC16"/><path d="M22 18c-3-3 3-5 0-9M32 18c-3-3 3-5 0-9M42 18c-3-3 3-5 0-9" stroke="#64748B" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  ],
  iceCream: [
    'pink',
    '<path d="M20 32h24L32 60z" fill="#F59E0B"/><path d="M24 34l8 14M30 33l7 14M40 34l-8 14M34 33l-7 14" stroke="#B45309" stroke-width="1.3"/><circle cx="32" cy="20" r="14" fill="#F472B6"/><path d="M18 26c0 4 3 4 4 7s5 3 6 0 3-2 5 0 5 2 6-1 4-2 6-6z" fill="#F472B6"/><circle cx="32" cy="6" r="3.5" fill="#EF4444"/><path d="M24 15c1.5-3 4-5 7-5.5" stroke="#FBCFE8" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
  ],
  bread: [
    'amber',
    '<path d="M8 27c0-9 8-15 24-15s24 6 24 15c0 3.5-2.5 6-5 7v16a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V34c-2.5-1-5-3.5-5-7z" fill="#B45309"/><path d="M12.5 27c0-6 7-11 19.5-11s19.5 5 19.5 11c0 2.5-2 4-4 4.5V48a2 2 0 0 1-2 2H18.5a2 2 0 0 1-2-2V31.5c-2-.5-4-2-4-4.5z" fill="#FDE68A"/><g fill="#F59E0B"><circle cx="24" cy="27" r="1.3"/><circle cx="33" cy="23" r="1.3"/><circle cx="41" cy="30" r="1.3"/><circle cx="28" cy="37" r="1.3"/><circle cx="38" cy="41" r="1.3"/></g>',
  ],
  croissant: [
    'orange',
    '<path d="M6 42C8 24 20 13 32 13s24 11 26 29c.5 4.5-4.5 7-7 3.5-3-5-5.5-8-8.5-9.5-2 3-4.5 4.5-10.5 4.5S23.5 39 21.5 36c-3 1.5-5.5 4.5-8.5 9.5-2.5 3.5-7.5 1-7-3.5z" fill="#F59E0B"/><path d="M21 17l-3.5 19M32 13v21M43 17l3.5 19M12 26l1 15M52 26l-1 15" stroke="#B45309" stroke-width="2.6" stroke-linecap="round"/>',
  ],
  // The shop's own groups.
  assorted: [
    'orange',
    '<path d="M21 25L29 8M43 25L35 8" stroke="#78350F" stroke-width="3.8" stroke-linecap="round"/><path d="M10 28h44l-5 25a3 3 0 0 1-3 2.5H18a3 3 0 0 1-3-2.5z" fill="#F97316"/><rect x="6" y="24" width="52" height="7" rx="3.5" fill="#C2410C"/><rect x="20" y="36" width="4.5" height="14" rx="2.2" fill="#FED7AA"/><rect x="29.7" y="36" width="4.5" height="14" rx="2.2" fill="#FED7AA"/><rect x="39.5" y="36" width="4.5" height="14" rx="2.2" fill="#FED7AA"/>',
  ],
  register: [
    'green',
    '<path d="M15 30h34l5 20H10z" fill="#475569"/><rect x="17" y="9" width="30" height="16" rx="2.5" fill="#1E293B"/><rect x="20" y="12" width="24" height="10" rx="1" fill="#4ADE80"/><rect x="28" y="25" width="8" height="6" fill="#334155"/><g fill="#E2E8F0"><rect x="19" y="34" width="5" height="3.5" rx=".8"/><rect x="26" y="34" width="5" height="3.5" rx=".8"/><rect x="33" y="34" width="5" height="3.5" rx=".8"/><rect x="40" y="34" width="5" height="3.5" rx=".8"/><rect x="18" y="41" width="5" height="3.5" rx=".8"/><rect x="25.5" y="41" width="5" height="3.5" rx=".8"/><rect x="33.5" y="41" width="5" height="3.5" rx=".8"/><rect x="41" y="41" width="5" height="3.5" rx=".8"/></g><rect x="8" y="49" width="48" height="7" rx="2.5" fill="#1E293B"/><rect x="26" y="51.5" width="12" height="2" rx="1" fill="#94A3B8"/>',
  ],
  packing: [
    'orange',
    '<path d="M10 23l22-11 22 11v28L32 60 10 51z" fill="#D6A25E"/><path d="M10 23l22 11 22-11-22-11z" fill="#EFCF9F"/><path d="M32 34v26" stroke="#A97C3D" stroke-width="1.8"/><path d="M20 18l22 11v9l-5-2.5v-6L15 20.5z" fill="#FEF3C7"/><path d="M37 49l11-4.5" stroke="#92400E" stroke-width="2" stroke-linecap="round"/><path d="M37 44l7-3" stroke="#92400E" stroke-width="2" stroke-linecap="round"/>',
  ],
  pieces: [
    'rose',
    '<path d="M17 8l3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3v10H17z" fill="#FDA4AF"/><rect x="17" y="17" width="30" height="31" fill="#E11D48"/><path d="M17 56l3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3V47H17z" fill="#FDA4AF"/><path d="M32 22l3 6.2 6.8 1-4.9 4.8 1.2 6.8-6.1-3.2-6.1 3.2 1.2-6.8-4.9-4.8 6.8-1z" fill="#FDE68A"/>',
  ],
  cigarette: [
    'slate',
    '<rect x="6" y="37" width="40" height="10" rx="1" fill="#fff"/><rect x="6" y="37" width="13" height="10" rx="1" fill="#F59E0B"/><path d="M19 37v10" stroke="#D97706" stroke-width="1.5"/><rect x="46" y="37" width="6" height="10" rx="1" fill="#64748B"/><rect x="50" y="37" width="4" height="10" rx="1" fill="#EF4444"/><path d="M50 30c-3.5-4 3.5-6 0-10.5S53.5 13 50 8.5" stroke="#64748B" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
  ],
  vape: [
    'indigo',
    '<rect x="17" y="24" width="18" height="33" rx="5" fill="#4F46E5"/><path d="M21 24l2-11h6l2 11z" fill="#1E293B"/><circle cx="26" cy="33" r="3.2" fill="#22D3EE"/><rect x="21.5" y="41" width="9" height="11" rx="2" fill="#A5B4FC"/><g fill="#fff"><circle cx="40" cy="14" r="5"/><circle cx="48" cy="11" r="6"/><circle cx="55" cy="16" r="4.5"/><rect x="39" y="14" width="17" height="6.5" rx="3.2"/></g>',
  ],
  slippers: [
    'cyan',
    '<path d="M20 8c8.5 0 13 7 13 17 0 6-1.8 10-1.8 15 0 9-3.2 15-11.2 15s-11.2-6-11.2-15c0-5-1.8-9-1.8-15 0-10 4.5-17 13-17z" fill="#0EA5E9"/><path d="M20 21L9 33M20 21l11 12" stroke="#F97316" stroke-width="4" stroke-linecap="round"/><rect x="39" y="15" width="17" height="39" rx="4" fill="#FB7185"/><rect x="39" y="24" width="17" height="4" fill="#fff"/><rect x="39" y="41" width="17" height="4" fill="#fff"/>',
  ],
  electric: [
    'amber',
    '<path d="M32 7a18 18 0 0 0-10.5 32.6c2 1.5 3 4 3 6.4h15c0-2.4 1-4.9 3-6.4A18 18 0 0 0 32 7z" fill="#FACC15"/><path d="M23 16c-3 2.5-4.5 6-4.5 9.5" stroke="#FEF9C3" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M26 27l6 5 6-5M32 32v14" stroke="#B45309" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="24.5" y="46" width="15" height="4.5" fill="#94A3B8"/><rect x="25.5" y="51" width="13" height="5" rx="2.5" fill="#475569"/>',
  ],
  bagsTape: [
    'green',
    '<path d="M9 9h7c0 7 2 11 6.5 11S29 16 29 9h7v41a2.5 2.5 0 0 1-2.5 2.5h-22A2.5 2.5 0 0 1 9 50z" fill="#22C55E"/><path d="M15 31h15M15 38h15" stroke="#BBF7D0" stroke-width="2.2" stroke-linecap="round"/><circle cx="42" cy="42" r="15" fill="#F59E0B"/><circle cx="42" cy="42" r="10" fill="#FDE68A"/><circle cx="42" cy="42" r="7" fill="#DCFCE7"/>',
  ],
  china: [
    'red',
    '<rect x="29" y="5" width="6" height="7" fill="#92400E"/><rect x="21" y="11" width="22" height="4.5" rx="1.5" fill="#F59E0B"/><ellipse cx="32" cy="30" rx="22" ry="17" fill="#DC2626"/><path d="M32 13v34M21 15c-6 8-6 22 0 30M43 15c6 8 6 22 0 30" stroke="#FCA5A5" stroke-width="1.8" fill="none"/><rect x="21" y="44.5" width="22" height="4.5" rx="1.5" fill="#F59E0B"/><path d="M27 49v9M32 49v11M37 49v9" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/>',
  ],
  japan: [
    'sky',
    '<circle cx="32" cy="23" r="15" fill="#EF4444"/><path d="M6 55l19-26c3.5-4.5 10.5-4.5 14 0l19 26z" fill="#4F46E5"/><path d="M25 29c3.5-4.5 10.5-4.5 14 0l4 5.5-4.5 2.5-3-3-3.5 3.5-3.5-3.5-3 3-4.5-2.5z" fill="#fff"/>',
  ],
  babyFood: [
    'amber',
    '<rect x="15" y="21" width="34" height="34" rx="7" fill="#fff"/><rect x="17" y="10" width="30" height="11" rx="2.5" fill="#F472B6"/><path d="M21 10v11M27 10v11M33 10v11M39 10v11M45 10v11" stroke="#FBCFE8" stroke-width="1.5"/><circle cx="32" cy="38" r="11" fill="#FDE68A"/><circle cx="28" cy="37" r="1.5" fill="#78350F"/><circle cx="36" cy="37" r="1.5" fill="#78350F"/><path d="M27.5 41.5c2.5 2.5 6.5 2.5 9 0" stroke="#78350F" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  ],
  puree: [
    'lime',
    '<rect x="27" y="5" width="10" height="9" rx="2" fill="#F97316"/><path d="M17 23l10-9h10l10 9z" fill="#A3E635"/><path d="M17 23h30v27a6 6 0 0 1-6 6H23a6 6 0 0 1-6-6z" fill="#65A30D"/><circle cx="32" cy="39" r="9.5" fill="#EF4444"/><path d="M32 29c0-2.5 1.5-4 4-4.5" stroke="#78350F" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M27 35c-1.5 1.5-2 3-2 5" stroke="#FCA5A5" stroke-width="2" stroke-linecap="round" fill="none"/>',
  ],
  toy: [
    'orange',
    '<circle cx="17" cy="14" r="7" fill="#B45309"/><circle cx="47" cy="14" r="7" fill="#B45309"/><circle cx="17" cy="14" r="3.5" fill="#FDE68A"/><circle cx="47" cy="14" r="3.5" fill="#FDE68A"/><ellipse cx="32" cy="48" rx="14" ry="11" fill="#B45309"/><ellipse cx="32" cy="50" rx="7.5" ry="6" fill="#FDE68A"/><circle cx="32" cy="24" r="17" fill="#D97706"/><ellipse cx="32" cy="30" rx="8" ry="6.5" fill="#FDE68A"/><circle cx="32" cy="27.5" r="2.3" fill="#451A03"/><path d="M28.5 32.5c2 1.5 5 1.5 7 0" stroke="#451A03" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="25" cy="21" r="2.3" fill="#451A03"/><circle cx="39" cy="21" r="2.3" fill="#451A03"/>',
  ],
  kidsGift: [
    'sky',
    '<path d="M46 30c-2.5 7 3 11 0 20" stroke="#64748B" stroke-width="1.5" fill="none"/><ellipse cx="46" cy="18" rx="10.5" ry="13" fill="#EC4899"/><path d="M41 12c1-2 2.5-3 4.5-3.5" stroke="#FBCFE8" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M46 31l-2 2.5h4z" fill="#EC4899"/><rect x="9" y="34" width="29" height="21" rx="2.5" fill="#F97316"/><rect x="7" y="28" width="33" height="8" rx="2" fill="#FB923C"/><rect x="20" y="28" width="7" height="27" fill="#FDE047"/><path d="M23.5 28c-3-7.5-11-9.5-12.5-4.5-1 4.5 7 5 12.5 4.5zM23.5 28c3-7.5 11-9.5 12.5-4.5 1 4.5-7 5-12.5 4.5z" fill="#FDE047"/>',
  ],
  ger: [
    'sky',
    '<path d="M8 36c8-12 18-20 24-22 6 2 16 10 24 22z" fill="#fff"/><path d="M14 30c1 2 1 4 0 6M23 23c1 4 1 9 0 13M32 21v15M41 23c-1 4-1 9 0 13M50 30c-1 2-1 4 0 6" stroke="#CBD5E1" stroke-width="1.5" fill="none"/><rect x="28" y="10" width="8" height="5" rx="1" fill="#92400E"/><rect x="9" y="36" width="46" height="19" fill="#F8FAFC"/><rect x="9" y="36" width="46" height="4" fill="#EF4444"/><rect x="9" y="50" width="46" height="2.5" fill="#2563EB"/><rect x="26.5" y="41" width="11" height="14" fill="#EA580C"/><path d="M32 41v14M26.5 48h11" stroke="#FDBA74" stroke-width="1.5"/>',
  ],
  stationery: [
    'blue',
    '<rect x="9" y="10" width="33" height="44" rx="3" fill="#3B82F6"/><rect x="9" y="10" width="6" height="44" rx="2" fill="#1D4ED8"/><rect x="20" y="17" width="16" height="9" rx="1.5" fill="#fff"/><g transform="rotate(30 42 32)"><rect x="37" y="12" width="10" height="33" fill="#FACC15"/><rect x="37" y="7" width="10" height="5.5" rx="1.5" fill="#F472B6"/><path d="M37 45h10l-5 12z" fill="#FDE68A"/><path d="M40.5 53.5L42 57l1.5-3.5z" fill="#1E293B"/><path d="M42 12v33" stroke="#EAB308" stroke-width="1.5"/></g>',
  ],
  baby: [
    'sky',
    '<path d="M28 13V8c0-3.5 8-3.5 8 0v5z" fill="#FBBF24"/><rect x="21" y="12" width="22" height="7" rx="2.5" fill="#2563EB"/><path d="M22 19h20l2.5 6v27a4 4 0 0 1-4 4h-17a4 4 0 0 1-4-4V25z" fill="#fff"/><path d="M19.5 33h25v19a4 4 0 0 1-4 4h-17a4 4 0 0 1-4-4z" fill="#93C5FD"/><path d="M37 28h7.5M37 36h7.5M37 44h7.5" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round"/>',
  ],
  gloves: [
    'red',
    '<path d="M21 7c8 0 13 5.5 13 13v13l6.5-6.5c3.5-3.5 9 1 6 5.5L36 46v5H15V20C15 13 14 7 21 7z" fill="#EF4444"/><rect x="13" y="46" width="25" height="11" rx="2.5" fill="#fff"/><path d="M18 46v11M23 46v11M28 46v11M33 46v11" stroke="#CBD5E1" stroke-width="1.5"/><path d="M21 14c-1.5 2-2 5-2 8" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
  ],
  // Home and care.
  household: [
    'blue',
    '<rect x="44" y="12" width="6" height="14" fill="#92400E"/><rect x="13" y="29" width="38" height="26" rx="2" fill="#FEF3C7"/><path d="M32 8L6 30a2 2 0 0 0 1.3 3.5h49.4A2 2 0 0 0 58 30z" fill="#EF4444"/><rect x="26.5" y="39" width="11" height="16" rx="1" fill="#92400E"/><circle cx="35" cy="47" r="1" fill="#FDE68A"/><rect x="16" y="38" width="7.5" height="7.5" rx="1" fill="#38BDF8"/><rect x="40.5" y="38" width="7.5" height="7.5" rx="1" fill="#38BDF8"/>',
  ],
  homeGoods: [
    'blue',
    '<path d="M13 22C13 5 51 5 51 22" fill="none" stroke="#64748B" stroke-width="3.2"/><path d="M13 23h38l-4.5 29a3 3 0 0 1-3 2.5h-23a3 3 0 0 1-3-2.5z" fill="#3B82F6"/><ellipse cx="32" cy="23" rx="19" ry="5.5" fill="#1D4ED8"/><path d="M20 33l2 14" stroke="#93C5FD" stroke-width="2.8" stroke-linecap="round"/><path d="M23 22c3-2 6 1 9 0s6-1 9 0" stroke="#7DD3FC" stroke-width="2" fill="none" stroke-linecap="round"/>',
  ],
  feminine: [
    'pink',
    '<g fill="#EC4899"><circle cx="32" cy="17" r="10"/><circle cx="46.5" cy="28" r="10"/><circle cx="41" cy="45" r="10"/><circle cx="23" cy="45" r="10"/><circle cx="17.5" cy="28" r="10"/></g><g fill="#F9A8D4"><circle cx="32" cy="19" r="5"/><circle cx="44" cy="28" r="5"/><circle cx="39.5" cy="42.5" r="5"/><circle cx="24.5" cy="42.5" r="5"/><circle cx="20" cy="28" r="5"/></g><circle cx="32" cy="32" r="7.5" fill="#FDE047"/>',
  ],
  cleaner: [
    'cyan',
    '<path d="M22 28h20l3.5 24a3 3 0 0 1-3 3h-21a3 3 0 0 1-3-3z" fill="#06B6D4"/><rect x="26" y="19" width="12" height="10" fill="#155E75"/><path d="M18 11h24v8H27l-4 4-6-5z" fill="#155E75"/><rect x="42" y="13" width="7" height="4" rx="1" fill="#F97316"/><rect x="23.5" y="35" width="17" height="13" rx="1.5" fill="#fff"/><path d="M28 41l3 3 5.5-6" stroke="#06B6D4" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><g fill="#06B6D4"><circle cx="54" cy="9" r="1.8"/><circle cx="56" cy="15" r="1.8"/><circle cx="54" cy="21" r="1.8"/></g>',
  ],
  detergent: [
    'sky',
    '<rect x="11" y="7" width="42" height="50" rx="6" fill="#fff"/><rect x="11" y="7" width="42" height="12" rx="6" fill="#CBD5E1"/><rect x="16" y="11" width="13" height="4" rx="1" fill="#64748B"/><circle cx="41" cy="13" r="2.5" fill="#22C55E"/><circle cx="48" cy="13" r="2.5" fill="#F97316"/><circle cx="32" cy="38" r="15" fill="#64748B"/><circle cx="32" cy="38" r="12" fill="#38BDF8"/><path d="M20.5 40c3.5-3.5 7.5 2.5 11.5 0s8-3.5 11.5 0v2A12 12 0 0 1 20.5 42z" fill="#0284C7"/><circle cx="28" cy="33" r="2.5" fill="#fff"/><circle cx="36" cy="31.5" r="1.8" fill="#fff"/>',
  ],
  soap: [
    'pink',
    '<g fill="#fff"><circle cx="22" cy="16" r="7"/><circle cx="36" cy="12" r="4.5"/><circle cx="46" cy="20" r="5.5"/></g><path d="M19 13c1-1 2-2 3.5-2.2M43.5 18c.7-.8 1.5-1.3 2.5-1.5" stroke="#7DD3FC" stroke-width="1.8" fill="none" stroke-linecap="round"/><rect x="9" y="27" width="46" height="27" rx="9" fill="#EC4899"/><rect x="15" y="32" width="34" height="17" rx="6" fill="#F9A8D4"/><path d="M23 40.5h18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
  ],
  shoeCare: [
    'amber',
    '<path d="M7 31c0-2.5 2.5-4.5 5-3.5l9 3.5c3.5 1.5 6 .5 8-2.5l4.5-6L48 38c3.5 1 9 2 9 8v4H7z" fill="#92400E"/><rect x="6" y="49" width="52" height="7" rx="3" fill="#451A03"/><path d="M28 32l6 4.5M25 36l6 4.5M34 26l6 4.5" stroke="#FDE68A" stroke-width="2.4" stroke-linecap="round"/><path d="M50 8l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FACC15"/><path d="M12 33c2 1.5 3 3.5 3.5 6" stroke="#D97706" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  ],
  toiletPaper: [
    'violet',
    '<path d="M10 24v32h22V24z" fill="#fff"/><path d="M10 45h22" stroke="#CBD5E1" stroke-width="1.8" stroke-dasharray="3 2.5"/><path d="M10 24a8 15 0 0 1 8-15h29v30H18a8 15 0 0 1-8-15z" fill="#F8FAFC"/><path d="M10 24a8 15 0 0 1 8-15h29v6H17a8 12 0 0 0-7 9z" fill="#fff"/><ellipse cx="47" cy="24" rx="8" ry="15" fill="#E2E8F0"/><ellipse cx="47" cy="24" rx="3.5" ry="7" fill="#7C3AED"/>',
  ],
  diaper: [
    'cyan',
    '<path d="M9 20h46v9c0 12-10 22-23 26C19 51 9 41 9 29z" fill="#fff"/><rect x="9" y="16" width="46" height="9" rx="3" fill="#38BDF8"/><rect x="6" y="22" width="11" height="8" rx="2.5" fill="#0284C7"/><rect x="47" y="22" width="11" height="8" rx="2.5" fill="#0284C7"/><path d="M32 30l2.3 4.6 5.1.8-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.8z" fill="#FACC15"/>',
  ],
  tissue: [
    'sky',
    '<path d="M23 28c-3-9 3-20 11-20 0 5.5 5 6 8.5 7-3.5 3.5-6 7-6 13z" fill="#fff"/><path d="M8 29l4-6h40l4 6v22a3.5 3.5 0 0 1-3.5 3.5h-41A3.5 3.5 0 0 1 8 51z" fill="#0EA5E9"/><ellipse cx="32" cy="29" rx="13" ry="3.8" fill="#075985"/><path d="M23 29c-.5-1.5-.5-2.5 0-4h14l-.5 4c-4 1-9 1-13.5 0z" fill="#fff"/><g fill="#BAE6FD"><circle cx="18" cy="42" r="3.2"/><circle cx="32" cy="46" r="3.2"/><circle cx="46" cy="42" r="3.2"/></g>',
  ],
  shampoo: [
    'violet',
    '<rect x="17" y="25" width="30" height="31" rx="6" fill="#8B5CF6"/><rect x="28" y="15" width="8" height="11" fill="#4C1D95"/><path d="M18 8h22a3 3 0 0 1 3 3v5h-7v-1H21v-3l-3 .5z" fill="#4C1D95"/><rect x="17" y="33" width="30" height="15" fill="#EDE9FE"/><path d="M32 35c2.8 3.4 4.5 5.2 4.5 7a4.5 4.5 0 0 1-9 0c0-1.8 1.7-3.6 4.5-7z" fill="#8B5CF6"/>',
  ],
  toothpaste: [
    'teal',
    '<path d="M32 19c-3.5-3.5-9-5.5-14.5-3.5-6.5 3-7.5 12-4.5 19.5 2 5.5 3.5 10 4.5 16 1 4.5 5.5 4.5 6.5 0 1-4.5 2-9 8-9s7 4.5 8 9c1 4.5 5.5 4.5 6.5 0 1-6 2.5-10.5 4.5-16 3-7.5 2-16.5-4.5-19.5C41 13.5 35.5 15.5 32 19z" fill="#fff"/><path d="M18 21c-2.5 1.5-3 5-2.5 8.5" stroke="#99F6E4" stroke-width="2.8" stroke-linecap="round" fill="none"/><path d="M52 5l1.7 4.3L58 11l-4.3 1.7L52 17l-1.7-4.3L46 11l4.3-1.7z" fill="#FACC15"/>',
  ],
  cosmetics: [
    'rose',
    '<rect x="21" y="36" width="22" height="21" rx="2.5" fill="#1E293B"/><rect x="23.5" y="27" width="17" height="10" fill="#FACC15"/><path d="M26 27V14l12-7v20z" fill="#E11D48"/><path d="M29 25V15" stroke="#FDA4AF" stroke-width="2" stroke-linecap="round"/><path d="M23.5 31h17" stroke="#CA8A04" stroke-width="1.4"/>',
  ],
  laundrySoap: [
    'blue',
    '<path d="M21 11L8 19l5 11 6-3v25a2.5 2.5 0 0 0 2.5 2.5h21A2.5 2.5 0 0 0 45 52V27l6 3 5-11-13-8c-2 4.5-6 7-11 7s-9-2.5-11-7z" fill="#2563EB"/><g fill="#fff"><circle cx="26" cy="33" r="4"/><circle cx="37" cy="38" r="5"/><circle cx="27" cy="45" r="3"/></g><path d="M24.5 31.5c.5-.5 1-.8 1.7-.9M35 36c.5-.6 1.2-1 2-1.1" stroke="#93C5FD" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  ],
  // When nothing fits, and what has no category yet.
  bag: [
    'teal',
    '<path d="M22 22v-5a10 10 0 0 1 20 0v5" fill="none" stroke="#0F766E" stroke-width="3.5" stroke-linecap="round"/><path d="M13 22h38l3 30a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z" fill="#14B8A6"/><circle cx="22" cy="28" r="2.2" fill="#CCFBF1"/><circle cx="42" cy="28" r="2.2" fill="#CCFBF1"/><path d="M23 40l6 6 12-12" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  ],
  uncategorized: [
    'slate',
    '<path d="M10 24l22-12 22 12v27L32 60 10 51z" fill="#94A3B8"/><path d="M10 24l22 12 22-12-22-12z" fill="#E2E8F0"/><path d="M32 36v24" stroke="#64748B" stroke-width="1.5"/><path d="M15 34c0-3 1.7-5 4-5s4 1.5 4 3.8c0 3-4 3-4 6" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round"/><circle cx="19" cy="44.5" r="1.8" fill="#fff"/>',
  ],
} as const satisfies Record<string, readonly [Tile, string]>;

export type CategoryIconKey = keyof typeof ART;

/** Every drawing's key, as `categories.icon_key` stores it. */
export const CATEGORY_ICON_KEYS = Object.keys(ART) as CategoryIconKey[];

const KEYS: ReadonlySet<string> = new Set(CATEGORY_ICON_KEYS);

export function isCategoryIconKey(value: string): value is CategoryIconKey {
  return KEYS.has(value);
}

/** A drawing as one SVG document on its tile, for an image on the web and `SvgXml` on the phones. */
export function categoryIconSvg(key: CategoryIconKey): string {
  const [tile, art] = ART[key];
  const [from, to] = TILES[tile];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#t)"/>${art}</svg>`;
}
