import type { EChartsCoreOption } from 'echarts/core';

/** Read once per drawing from `index.css`: the tokens as the chart library needs them. */
export interface ChartColors {
  /** The categorical series, in their fixed order (validated for colour blindness). */
  series: readonly string[];
  male: string;
  female: string;
  unknown: string;
  good: string;
  warn: string;
  bad: string;
  primary: string;
  foreground: string;
  muted: string;
  grid: string;
  surface: string;
}

function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

export function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  return {
    series: [1, 2, 3, 4, 5].map((slot) => token(style, `--series-${slot}`, '#0071e3')),
    male: token(style, '--series-1', '#0071e3'),
    female: token(style, '--series-5', '#c2255c'),
    unknown: token(style, '--muted-foreground', '#636366'),
    good: token(style, '--success', '#1e7b34'),
    warn: token(style, '--warning', '#b25000'),
    bad: token(style, '--destructive', '#d70015'),
    primary: token(style, '--primary', '#0071e3'),
    foreground: token(style, '--foreground', '#1d1d1f'),
    muted: token(style, '--muted-foreground', '#636366'),
    grid: token(style, '--border', '#e5e5ea'),
    surface: token(style, '--card', '#ffffff'),
  };
}

/** The look every chart shares; a page's option goes on top of it. */
export function baseOption(colors: ChartColors): EChartsCoreOption {
  return {
    color: [...colors.series],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter Variable, Inter, system-ui, sans-serif', color: colors.muted },
    animationDuration: 900,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 500,
    animationEasingUpdate: 'cubicInOut',
    tooltip: {
      backgroundColor: colors.surface,
      borderColor: colors.grid,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: colors.foreground, fontSize: 13 },
      extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.10);',
    },
  };
}
