import { useTranslation } from 'react-i18next';
import { type ErxesWaitIssue, useErxesOrderDeal } from './api';

/** Why a pull or a sign-in failed, as the key of its text. */
export const FAILURE_KEYS = {
  LOGIN_FAILED: 'loginFailed',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  UNEXPECTED_ANSWER: 'unexpectedAnswer',
  NOT_CONFIGURED: 'notConfigured',
  KEY_UNREADABLE: 'keyUnreadable',
  INTERNAL: 'internal',
} as const;

export type ErxesFailure = keyof typeof FAILURE_KEYS;

/** One reason a deal waits, in plain words (ADR-0218 #6). */
export function useIssueText(): (issue: ErxesWaitIssue) => string {
  const { t, i18n } = useTranslation();
  return (issue) => {
    const what = [issue.name, issue.code].filter(Boolean).join(' · ');
    if (issue.reason === 'ORDER_REFUSED') {
      // Bto's own refusal: the text its error code has everywhere else.
      const key = `errors.${issue.errorCode ?? ''}`;
      const plain = t as unknown as (key: string) => string;
      return t('erxes.reason.ORDER_REFUSED', {
        error: i18n.exists(key) ? plain(key) : (issue.errorCode ?? ''),
      });
    }
    return t(`erxes.reason.${issue.reason}`, { what });
  };
}

/**
 * Who entered a copied order when no Bto user is the erxes creator (ADR-0218 #5): «Erxes: нэр».
 * Null for an order made in Bto and for one whose creator is a Bto user, so the order panel shows
 * its own «Оруулсан» name.
 */
export function useErxesCreatorName(orderId: number): string | null {
  const { t } = useTranslation();
  const deal = useErxesOrderDeal(orderId).data?.deal;
  if (!deal || deal.creatorUserId !== null) return null;
  return t('erxes.section.creator', { name: deal.creatorName ?? t('erxes.deal.unknown') });
}
