import { useTranslation } from 'react-i18next';
import { knownUnit } from './units';

/** A unit's words on screen: «ширхэг», «ш», «Ширхэг», «ширхэгт». */
export interface UnitWords {
  name: string;
  short: string;
  title: string;
  /** «хайрцагт» (in a box); null for a unit the app has no word forms for. */
  dative: string | null;
  /** «ширхэгээр» (by the piece); null as above. */
  instrumental: string | null;
}

/**
 * The words of a unit (ADR-0066): the system units' forms from mn.json (their stored names are
 * short, «ш»), a custom unit's own name otherwise.
 */
export function useUnitWords() {
  const { t } = useTranslation();
  return (unit: { uomCode?: string | null; uomName: string }): UnitWords => {
    const known = knownUnit(unit.uomCode);
    if (known) {
      return {
        name: t(`mobile.units.${known}.name`),
        short: t(`mobile.units.${known}.short`),
        title: t(`mobile.units.${known}.title`),
        dative: t(`mobile.units.${known}.dative`),
        instrumental: t(`mobile.units.${known}.instrumental`),
      };
    }
    const name = unit.uomName;
    return {
      name,
      short: name,
      title: name.charAt(0).toUpperCase() + name.slice(1),
      dative: null,
      instrumental: null,
    };
  };
}
