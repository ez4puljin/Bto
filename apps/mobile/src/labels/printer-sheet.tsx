import type { ApiClient } from '@tugeel/api-client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { colors, spacing, type } from '../theme/tokens';
import { PillButton, Segmented } from '../ui/controls';
import { Group, Row } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';
import { fetchStations } from './api';
import {
  BluetoothError,
  type BluetoothFailure,
  type PairedPrinter,
  pairedPrinters,
} from './bluetooth';
import type { PrinterChoice } from './prefs';

type Paired =
  | { status: 'loading' }
  | { status: 'ready'; printers: PairedPrinter[] }
  | { status: 'failed'; failure: BluetoothFailure };

/** «Принтер»: the phone's paired Bluetooth printers, or the printers attached to a PC. */
export function PrinterSheet({
  visible,
  onClose,
  client,
  value,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  client: ApiClient;
  value: PrinterChoice | null;
  onChange: (printer: PrinterChoice) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PrinterChoice['kind']>(value?.kind ?? 'bluetooth');
  const [paired, setPaired] = useState<Paired>({ status: 'loading' });

  const loadPaired = useCallback(async () => {
    setPaired({ status: 'loading' });
    try {
      setPaired({ status: 'ready', printers: await pairedPrinters() });
    } catch (error) {
      setPaired({
        status: 'failed',
        failure: error instanceof BluetoothError ? error.failure : 'bluetoothMissing',
      });
    }
  }, []);

  useEffect(() => {
    if (visible && mode === 'bluetooth') void loadPaired();
  }, [visible, mode, loadPaired]);

  const stations = useQuery({
    queryKey: ['labels', 'stations'],
    queryFn: () => fetchStations(client),
    enabled: visible && mode === 'pc',
    staleTime: 0,
  });

  const choose = (printer: PrinterChoice) => {
    onChange(printer);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('mobile.labels.close')}
      fit
      header={
        <SheetHeader
          title={t('mobile.labels.choosePrinter')}
          right={<SheetClose onPress={onClose} label={t('mobile.labels.close')} />}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Segmented
          label={t('mobile.labels.printer')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'bluetooth', label: t('mobile.labels.bluetooth') },
            { value: 'pc', label: t('mobile.labels.pcPrinter') },
          ]}
        />
        {mode === 'bluetooth' ? (
          paired.status === 'loading' ? (
            <ActivityIndicator color={colors.primary} />
          ) : paired.status === 'failed' ? (
            <View style={styles.gap}>
              <View accessibilityRole="alert">
                <Text style={[type.body, styles.error]}>
                  {t(`mobile.labels.errors.${paired.failure}`)}
                </Text>
              </View>
              <PillButton
                title={t('mobile.labels.refresh')}
                variant="soft"
                onPress={() => void loadPaired()}
              />
            </View>
          ) : paired.printers.length === 0 ? (
            <View style={styles.gap}>
              <Text style={[type.body, styles.hint]}>{t('mobile.labels.noPaired')}</Text>
              <PillButton
                title={t('mobile.labels.refresh')}
                variant="soft"
                onPress={() => void loadPaired()}
              />
            </View>
          ) : (
            <Group>
              {paired.printers.map((printer) => (
                <Row
                  key={printer.address}
                  title={printer.name}
                  subtitle={printer.address}
                  chevron={false}
                  checked={value?.kind === 'bluetooth' && value.address === printer.address}
                  onPress={() =>
                    choose({ kind: 'bluetooth', address: printer.address, name: printer.name })
                  }
                />
              ))}
            </Group>
          )
        ) : stations.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : stations.error ? (
          <View style={styles.gap}>
            <ProblemText problem={problemFrom(stations.error)} />
            <PillButton
              title={t('mobile.labels.refresh')}
              variant="soft"
              onPress={() => void stations.refetch()}
            />
          </View>
        ) : stations.data.length === 0 ? (
          <Text style={[type.body, styles.hint]}>{t('mobile.labels.noStations')}</Text>
        ) : (
          <Group>
            {stations.data.map((station) => (
              <Row
                key={station.id}
                title={station.name}
                subtitle={station.online ? null : t('mobile.labels.offline')}
                chevron={false}
                disabled={!station.online}
                checked={value?.kind === 'pc' && value.stationId === station.id}
                onPress={() => choose({ kind: 'pc', stationId: station.id })}
              />
            ))}
          </Group>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  gap: { gap: spacing.md },
  hint: { color: colors.muted },
  error: { color: colors.destructive },
});
