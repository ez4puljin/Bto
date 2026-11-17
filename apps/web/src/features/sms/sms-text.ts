import { isSmsErrorCode } from '@tugeel/shared/notifications';
import { useTranslation } from 'react-i18next';

/** The Mongolian reason for an SMS code (WeSend's or ours); a code we do not know reads as unknown. */
export function useSmsReason() {
  const { t } = useTranslation();
  return (code: string | null | undefined): string =>
    t(`sms.errors.${code && isSmsErrorCode(code) ? code : 'unknown_error'}`);
}
