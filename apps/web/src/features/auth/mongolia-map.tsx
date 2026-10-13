import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MAP_HEIGHT, MAP_WIDTH, PLACES, project, routePath } from './mongolia';
import { AIMAGS } from './mongolia-aimags';

type Place = keyof typeof PLACES;

const MAIN_AIMAG = 'MN-041'; // Khövsgöl: «Оргил Бөөний төв» in Mörön, the main branch
const BRANCH_AIMAG = 'MN-055'; // Övörkhangai: «Боломж бөөний төв» in Kharkhorin
const CAPITAL = 'MN-1'; // Ulaanbaatar
const HIGHLIGHT: Record<string, { fill: string; stroke: string; className?: string }> = {
  [MAIN_AIMAG]: {
    fill: 'url(#bto-main)',
    stroke: '#8fd3ff',
    className: 'motion-safe:animate-[bto-breathe_4s_ease-in-out_infinite]',
  },
  [BRANCH_AIMAG]: { fill: 'url(#bto-branch)', stroke: '#8fd3ff' },
  [CAPITAL]: { fill: 'rgb(255 214 10 / 0.75)', stroke: '#ffe066' },
};

/** Where a place sits on the map, in percent of its box (for the HTML labels). */
function at(place: Place): CSSProperties {
  const [x, y] = project(PLACES[place]);
  return { left: `${(x / MAP_WIDTH) * 100}%`, top: `${(y / MAP_HEIGHT) * 100}%` };
}

/**
 * The login page's map (owner, 2026-10-13): Mongolia with every aimag's border, Khövsgöl and
 * Övörkhangai lit, the capital in gold, and light travelling from the main branch in Mörön to the
 * branch in Kharkhorin. Decorative (`aria-hidden`): the legend beside it says the same in text.
 */
export function MongoliaMap({ className }: { className?: string }) {
  const { t } = useTranslation();
  const route = routePath(PLACES.muron, PLACES.kharkhorin);
  const [cx, cy] = project(PLACES.ulaanbaatar);

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        aria-hidden
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="block h-auto w-full overflow-visible"
      >
        <defs>
          <linearGradient id="bto-main" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#2997ff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#5e5ce6" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="bto-branch" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#64d2ff" stopOpacity="0.6" />
            <stop offset="1" stopColor="#0a84ff" stopOpacity="0.35" />
          </linearGradient>
          <filter id="bto-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* The country's edge: a blurred halo, then a crisp line whose inner half the fills cover. */}
        <g className="motion-safe:animate-[bto-fade_1.2s_ease-out_both]">
          <g filter="url(#bto-glow)" opacity="0.55">
            {AIMAGS.map((aimag) => (
              <path key={aimag.code} d={aimag.d} fill="none" stroke="#2997ff" strokeWidth="10" />
            ))}
          </g>
          {AIMAGS.map((aimag) => (
            <path
              key={aimag.code}
              d={aimag.d}
              fill="none"
              stroke="rgb(160 200 255 / 0.75)"
              strokeWidth="3.2"
              strokeLinejoin="round"
            />
          ))}
        </g>

        {/* Every aimag, with its border. */}
        {AIMAGS.map((aimag, index) => (
          <path
            key={aimag.code}
            d={aimag.d}
            fillRule="evenodd"
            fill="#0e1f47"
            stroke="rgb(255 255 255 / 0.16)"
            strokeWidth="1"
            strokeLinejoin="round"
            className="motion-safe:animate-[bto-fade_0.9s_ease-out_both]"
            style={{ animationDelay: `${0.15 + index * 0.03}s` }}
          />
        ))}

        {/* The two branches' aimags and the capital, lit. */}
        {AIMAGS.filter((aimag) => HIGHLIGHT[aimag.code]).map((aimag) => {
          const look = HIGHLIGHT[aimag.code]!;
          return (
            <path
              key={aimag.code}
              d={aimag.d}
              fillRule="evenodd"
              fill={look.fill}
              stroke={look.stroke}
              strokeWidth="1.4"
              strokeLinejoin="round"
              className={cn(
                'motion-safe:animate-[bto-fade_1s_ease-out_both] [animation-delay:0.9s]',
                look.className,
              )}
            />
          );
        })}

        {/* Main branch → branch: a faint arc, a dashed trail and a travelling light. */}
        <path
          d={route}
          fill="none"
          stroke="rgb(143 211 255 / 0.22)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d={route}
          fill="none"
          stroke="#8fd3ff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 8"
          className="motion-safe:animate-[bto-dash_1.4s_linear_infinite]"
        />
        <path
          d={route}
          pathLength={100}
          fill="none"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeDasharray="16 100"
          strokeDashoffset="16"
          className="motion-safe:animate-[bto-comet_2.6s_cubic-bezier(0.45,0,0.25,1)_1.6s_infinite]"
          strokeWidth="9"
          opacity="0.6"
          filter="url(#bto-glow)"
        />
        <path
          d={route}
          pathLength={100}
          fill="none"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeDasharray="16 100"
          strokeDashoffset="16"
          className="motion-safe:animate-[bto-comet_2.6s_cubic-bezier(0.45,0,0.25,1)_1.6s_infinite]"
          strokeWidth="3.5"
        />

        {/* The capital: a gold star. */}
        <g transform={`translate(${cx} ${cy})`}>
          <circle r="22" fill="rgb(255 214 10 / 0.18)" filter="url(#bto-glow)" />
          <path
            d="M0,-9 L2.6,-2.8 L9,-2.8 L3.9,1.2 L5.6,7.6 L0,3.9 L-5.6,7.6 L-3.9,1.2 L-9,-2.8 L-2.6,-2.8 Z"
            fill="#ffd60a"
            stroke="#fff3b0"
            strokeWidth="0.8"
            className="origin-center [transform-box:fill-box] motion-safe:animate-[bto-pop_0.6s_ease-out_both] [animation-delay:1.1s]"
          />
        </g>

        {/* The branches: a pulsing ring and a white core. */}
        {(['muron', 'kharkhorin'] as const).map((place, index) => {
          const [x, y] = project(PLACES[place]);
          const main = place === 'muron';
          return (
            <g key={place} transform={`translate(${x} ${y})`}>
              <circle r={main ? 30 : 22} fill="rgb(100 210 255 / 0.25)" filter="url(#bto-glow)" />
              <circle
                r={main ? 10 : 8}
                fill="none"
                stroke="#8fd3ff"
                strokeWidth="2"
                className="origin-center [transform-box:fill-box] motion-safe:animate-[bto-ping_2.6s_cubic-bezier(0,0,0.2,1)_infinite]"
                style={{ animationDelay: `${1.2 + index * 0.9}s` }}
              />
              <circle
                r={main ? 8.5 : 6.5}
                fill="#ffffff"
                className="origin-center [transform-box:fill-box] motion-safe:animate-[bto-pop_0.6s_ease-out_both]"
                style={{ animationDelay: `${1 + index * 0.15}s` }}
              />
              <circle r={main ? 4 : 3} fill="#0a84ff" />
            </g>
          );
        })}
      </svg>

      <MapLabel
        style={at('muron')}
        position="above"
        title={t('brand.centers.orgil')}
        place={`${t('brand.aimags.khovsgol')} · ${t('brand.places.muron')}`}
        badge={t('brand.mainBranch')}
        tone="main"
      />
      <MapLabel
        style={at('kharkhorin')}
        position="below"
        title={t('brand.centers.bolomj')}
        place={`${t('brand.aimags.uvurkhangai')} · ${t('brand.places.kharkhorin')}`}
        badge={t('brand.branch')}
        tone="branch"
      />
      <MapLabel
        style={at('ulaanbaatar')}
        position="right"
        title={t('brand.places.ulaanbaatar')}
        place={t('brand.capital')}
        tone="capital"
      />
    </div>
  );
}

function MapLabel(props: {
  style: CSSProperties;
  position: 'above' | 'below' | 'right';
  title: string;
  place: string;
  badge?: string;
  tone: 'main' | 'branch' | 'capital';
}) {
  return (
    <div
      aria-hidden
      style={props.style}
      className={cn(
        'pointer-events-none absolute flex flex-col gap-0.5 rounded-2xl px-3.5 py-2 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.65)] ring-1 backdrop-blur-xl motion-safe:animate-[bto-rise_0.8s_ease-out_both]',
        props.tone === 'capital'
          ? 'bg-[#2b2410]/55 ring-[#ffd60a]/30 [animation-delay:1.3s]'
          : 'bg-white/10 ring-white/20 [animation-delay:1.4s]',
        props.position === 'above' && '-translate-x-1/2 -translate-y-[calc(100%+1.6rem)]',
        props.position === 'below' && '-translate-x-1/2 translate-y-7',
        props.position === 'right' && 'translate-x-6 -translate-y-1/2',
      )}
    >
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span
          className={cn(
            'leading-tight font-semibold',
            props.tone === 'main' ? 'text-base' : 'text-[15px]',
          )}
        >
          {props.title}
        </span>
        {props.badge ? (
          <span
            className={cn(
              'rounded-full px-2 py-px text-[11px] font-semibold',
              props.tone === 'main' ? 'bg-[#0a84ff] text-white' : 'bg-[#64d2ff]/25 text-[#bfe9ff]',
            )}
          >
            {props.badge}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'text-xs leading-tight whitespace-nowrap',
          props.tone === 'capital' ? 'text-[#ffe066]/85' : 'text-white/65',
        )}
      >
        {props.place}
      </span>
    </div>
  );
}
