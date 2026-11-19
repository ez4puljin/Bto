import { CloudDownload, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native';
import { useKept } from '../state/kept';
import { useSignedIn } from '../state/session';
import { colors } from '../theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { keptAt } from './kept-note';

/**
 * «Профайл»'s «Сервергүй ажиллах өгөгдөл» (ADR-0225 #2): when the kept copy was taken and how big
 * it is, the download's progress, and «Одоо шинэчлэх» (only with a connection). A rep only.
 */
export function KeptRow() {
  const { t } = useTranslation();
  const { offline } = useSignedIn();
  const { store, state, refresh } = useKept();
  if (!store) return null;
  const { pointer, progress, failed } = state;
  const subtitle = progress
    ? t(`mobile.offlineData.progress.${progress.phase}`, { n: progress.rows })
    : [
        pointer
          ? t('mobile.offlineData.summary', {
              at: keptAt(pointer.at),
              products: pointer.products,
              customers: pointer.customers,
            })
          : t('mobile.offlineData.none'),
        failed ? t('mobile.offlineData.failed') : null,
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <Group inset={ICON_INSET}>
      <Row
        icon={
          <IconTile color={colors.tint.teal}>
            <CloudDownload size={18} strokeWidth={2.2} color={colors.primaryForeground} />
          </IconTile>
        }
        title={t('mobile.offlineData.title')}
        subtitle={subtitle}
        right={progress ? <ActivityIndicator color={colors.primary} /> : undefined}
      />
      <Row
        icon={
          <IconTile color={colors.tint.blue}>
            <RefreshCw size={18} strokeWidth={2.2} color={colors.primaryForeground} />
          </IconTile>
        }
        title={offline ? t('mobile.offlineData.refreshOffline') : t('mobile.offlineData.refresh')}
        accent={!offline}
        disabled={offline || progress !== null}
        chevron={false}
        onPress={() => void refresh()}
      />
    </Group>
  );
}
