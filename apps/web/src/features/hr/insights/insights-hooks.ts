import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UNKNOWN } from './insights-format';

/* The dashboard's two hooks: its keys in words, and the numbers that count up. */

type LabelSection =
  | 'tenure'
  | 'ageBands'
  | 'childBands'
  | 'education'
  | 'marital'
  | 'levels'
  | 'leftReasons'
  | 'genders'
  | 'requestStatuses';

/** The server's keys in words; `UNKNOWN` is «Тодорхойгүй» everywhere. */
export function useInsightLabels() {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => ({
      unknown: t('hr.insights.unknown'),
      /** A key of a fixed list; one the texts do not know yet shows as it came. */
      label(section: LabelSection, key: string): string {
        if (key === UNKNOWN) return t('hr.insights.unknown');
        const path = `hr.insights.${section}.${key}`;
        return i18n.exists(path) ? String(t(path as never)) : key;
      },
      /** A free text the server groups by (a division, a district). */
      name(value: string | null): string {
        return value === null || value === UNKNOWN ? t('hr.insights.unknown') : value;
      },
    }),
    [t, i18n],
  );
}

const stillMotion = () =>
  typeof window.matchMedia !== 'function' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts up to its figure on arrival and on to the next when the range changes. It
 * is the figure at once for someone who asked their system for less motion.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [shown, setShown] = useState(() => (stillMotion() ? target : 0));
  const current = useRef(shown);
  useEffect(() => {
    if (stillMotion()) {
      current.current = target;
      setShown(target);
      return undefined;
    }
    const origin = current.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const value = progress === 1 ? target : origin + (target - origin) * eased;
      current.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return shown;
}
