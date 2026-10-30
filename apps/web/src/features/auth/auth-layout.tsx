import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_HEIGHT, MAP_WIDTH } from './mongolia';
import { MongoliaMap } from './mongolia-map';

/**
 * The map's width: 52rem at most, and never so wide that its height (width ÷ the map's aspect)
 * passes what the window leaves beside the mark, the title and the legend (about 20rem).
 */
const MAP_MAX_WIDTH = `min(52rem, calc((100svh - 20rem) * ${(MAP_WIDTH / MAP_HEIGHT).toFixed(3)}))`;

/** The «B» mark of Bto: a blue rounded square, white letter. */
function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden
      className={
        size === 'lg'
          ? 'grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#2997ff] to-[#0062d1] text-xl font-bold text-white shadow-[0_8px_24px_-6px_rgb(10_132_255/0.6)]'
          : 'grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#2997ff] to-[#0062d1] text-base font-bold text-white shadow-control'
      }
    >
      {t('app.name').charAt(0)}
    </span>
  );
}

/**
 * The sign-in and password-setup pages (owner, 2026-10-13): the screen split in two. Left, on deep
 * blue, the Bto mark and Mongolia with every aimag's border: the main branch «Оргил Бөөний төв» in
 * Mörön (Khövsgöl), the branch «Боломж бөөний төв» in Kharkhorin (Övörkhangai) and the capital,
 * with a text legend; right, the form. On narrow screens only the form shows, under the mark.
 */
export function AuthLayout(props: { title: string; description?: string; children: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${props.title} · ${t('app.name')}`;
  }, [props.title, t]);
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-[#06122b] text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(70%_55%_at_25%_15%,rgb(10_132_255/0.38),transparent_70%),radial-gradient(55%_45%_at_85%_95%,rgb(94_92_230/0.32),transparent_70%),radial-gradient(40%_35%_at_70%_40%,rgb(100_210_255/0.12),transparent_70%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(75%_65%_at_50%_45%,black,transparent)]"
        />
        {/* A laptop's short screen (1366×633) keeps the whole panel without a scroll: tighter
            spacing below 760px of height, and the map never taller than the height leaves it. */}
        <header className="relative flex items-center gap-3 px-12 pt-11 [@media(max-height:760px)]:pt-7">
          <BrandMark size="lg" />
          <div>
            <p className="text-[1.625rem] leading-none font-semibold tracking-tight">
              {t('app.name')}
            </p>
            <p className="mt-1.5 text-sm text-white/65">{t('brand.tagline')}</p>
          </div>
        </header>
        <div className="relative flex flex-1 flex-col justify-center px-10 py-8 xl:px-14 [@media(max-height:760px)]:py-3">
          {/* Its full margin stays: the main branch's label reaches above the map. */}
          <p className="mb-6 text-[0.8125rem] font-medium tracking-wide text-[#64d2ff] uppercase">
            {t('brand.mapTitle')}
          </p>
          <div style={{ maxWidth: MAP_MAX_WIDTH }}>
            <MongoliaMap className="xl:scale-[1.04]" />
          </div>
        </div>
        <footer className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-12 pb-11 [@media(max-height:760px)]:pb-7">
          <ul className="flex flex-col gap-2.5 text-sm">
            <li className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-white ring-4 ring-[#0a84ff]/50"
              />
              <span className="font-semibold">{t('brand.centers.orgil')}</span>
              <span className="text-white/55">
                {`${t('brand.mainBranch')} · ${t('brand.aimags.khovsgol')}, ${t('brand.places.muron')}`}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-[#8fd3ff] ring-4 ring-[#64d2ff]/25"
              />
              <span className="font-semibold">{t('brand.centers.bolomj')}</span>
              <span className="text-white/55">
                {`${t('brand.branch')} · ${t('brand.aimags.uvurkhangai')}, ${t('brand.places.kharkhorin')}`}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-[#ffd60a] ring-4 ring-[#ffd60a]/20"
              />
              <span className="font-semibold">{t('brand.places.ulaanbaatar')}</span>
              <span className="text-white/55">{t('brand.capital')}</span>
            </li>
          </ul>
          <p className="text-xs text-white/45">{t('brand.owner')}</p>
        </footer>
      </aside>
      <main className="flex min-h-svh flex-col">
        <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10 [@media(max-height:760px)]:py-8">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-2.5 lg:hidden">
              <BrandMark />
              <div>
                <p className="text-lg leading-none font-semibold tracking-tight">{t('app.name')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('brand.tagline')}</p>
              </div>
            </div>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
              {props.title}
            </h1>
            {props.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{props.description}</p>
            ) : null}
            <div className="mt-8">{props.children}</div>
          </div>
        </div>
        <footer className="px-6 pb-6 text-center text-xs text-muted-foreground sm:px-10 lg:hidden">
          {t('brand.owner')}
        </footer>
      </main>
    </div>
  );
}
