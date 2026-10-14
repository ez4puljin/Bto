import { mapsUrl, parseCoordinates } from '@tugeel/shared/geo';
import { MapPin } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

/** "Open on the map" for a stored or typed point; opens Google Maps in a new tab. */
export function MapLink({ lat, lng }: { lat: string; lng: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={mapsUrl({ lat, lng })}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm text-link underline-offset-4 hover:underline"
    >
      <MapPin className="size-3.5" />
      {t('partners.addresses.openMap')}
    </a>
  );
}

/**
 * The GPS box: the office pastes a Google Maps link or "47.918412, 106.917712" (SPEC §5.3). The
 * point it reads is shown with a map link at once, so a wrong pin is caught before saving. Only the
 * control: the caller labels it and shows its error (`FormRow` / `FormField`, ADR-0043).
 */
export function GpsField(props: {
  id: string;
  value: string;
  registration: UseFormRegisterReturn;
}) {
  const { t } = useTranslation();
  const parsed = parseCoordinates(props.value);
  return (
    <>
      <Input
        id={props.id}
        autoComplete="off"
        placeholder={t('partners.addresses.gpsPlaceholder')}
        {...props.registration}
      />
      {parsed.ok ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-muted-foreground">
            {`${parsed.value.lat}, ${parsed.value.lng}`}
          </span>
          <MapLink lat={parsed.value.lat} lng={parsed.value.lng} />
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('partners.addresses.gpsHint')}</p>
      )}
    </>
  );
}
