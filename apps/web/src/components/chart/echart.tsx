import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { baseOption, type ChartColors, chartColors } from './chart-colors';

export type { ChartColors } from './chart-colors';

/*
 * The animated charts of the dashboards (ADR-0146 #7): Apache ECharts on a canvas. The bars rise,
 * the rings sweep and the lines draw on arrival; a filter's new figures move from the old ones
 * instead of redrawing. Someone who asked their system for less motion gets the chart at once.
 * Colours come from the design tokens through `chartColors`, never from literals in a page.
 */

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** jsdom has no canvas: the tests read the chart's table instead. */
const canDraw = () => !navigator.userAgent.includes('jsdom');

/**
 * One chart. `label` names it for a screen reader and `children` are its figures as a table or
 * list, kept in the page for those who cannot see the canvas. It follows its box's width.
 */
export function EChart(props: {
  option: (colors: ChartColors) => EChartsCoreOption;
  label: string;
  height?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const latest = useRef(props.option);
  latest.current = props.option;

  const draw = () => {
    if (!chart.current) return;
    const colors = chartColors();
    const motion = reducedMotion() ? { animation: false } : {};
    chart.current.setOption(
      { ...baseOption(colors), ...motion, ...latest.current(colors) },
      {
        notMerge: false,
        lazyUpdate: true,
      },
    );
  };

  useEffect(() => {
    if (!canDraw() || !box.current) return undefined;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void import('./echart-core').then(({ echarts }) => {
      if (cancelled || !box.current) return;
      chart.current = echarts.init(box.current, undefined, { renderer: 'canvas' });
      draw();
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(box.current);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
    // Mounted once; new figures go through the effect below.
  }, []);

  useEffect(draw);

  return (
    <figure className={cn('m-0 min-w-0', props.className)}>
      <div
        ref={box}
        role="img"
        aria-label={props.label}
        style={{ height: props.height ?? 260, width: '100%' }}
      />
      {props.children ? <figcaption className="sr-only">{props.children}</figcaption> : null}
    </figure>
  );
}
