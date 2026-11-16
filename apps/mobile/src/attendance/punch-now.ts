import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type MyAttendance, usePunch } from '../api/attendance';
import { ubTime } from '../dates/dates';
import { useToast } from '../ui/toast';
import { blockerOf, type Fix, nextKind } from './status';

/**
 * «Нүүр»'s punch (owner 2026-11-16): one press reads the phone's place once and sends «ирсэн» or
 * «явсан», whichever comes next. Whatever stands in the way — no permission, the location off, a
 * loose fix, outside the site, the server's refusal — opens «Ирц», which says why and waits there.
 */
export function usePunchNow(data: MyAttendance | undefined): {
  kind: 'IN' | 'OUT';
  busy: boolean;
  press: () => void;
} {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const punch = usePunch();
  const [busy, setBusy] = useState(false);
  const kind = nextKind(data?.state ?? null);

  const run = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('no permission');
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const accuracy = position.coords.accuracy;
      const fix: Fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM:
          typeof accuracy === 'number' && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      };
      if (blockerOf(fix, data.sites) !== null) throw new Error('blocked');
      const event = await punch.mutateAsync({
        kind,
        lat: String(fix.lat),
        lng: String(fix.lng),
        accuracyM: fix.accuracyM,
      });
      toast.show({
        message: t(
          event.kind === 'IN' ? 'mobile.attendance.punchedIn' : 'mobile.attendance.punchedOut',
          { time: ubTime(event.at) },
        ),
      });
    } catch {
      router.push('/attendance');
    } finally {
      setBusy(false);
    }
  };

  return { kind, busy, press: () => void run() };
}
