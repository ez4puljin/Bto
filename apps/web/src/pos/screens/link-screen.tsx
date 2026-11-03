import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EDGE_CODE_PATTERN,
  type EdgeLinkRequest,
  type EdgeLinkState,
  normalizeEdgeLinkCode,
} from '@tugeel/shared/pos';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandMark, CenteredScreen, KioskAlert } from '../components/layout';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { kioskKeys } from '../queries';

const URL_LIKE = /^(https?:\/\/)?[^\s/]+(:\d{1,5})?\/?$/i;

/**
 * ADR-0136: the first screen of a new edge — the centre's address, the edge's code and the
 * one-time code an admin took from «Супермаркет → Касс». The edge asks the centre for its token and
 * the PIN key itself; nothing secret is typed. Shown again when the centre refused the edge's token.
 */
export function LinkScreen({ state }: { state: EdgeLinkState }) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [centralUrl, setCentralUrl] = useState(state.centralUrl ?? '');
  const [nodeCode, setNodeCode] = useState(state.nodeCode ?? '');
  const [linkCode, setLinkCode] = useState('');
  const [tried, setTried] = useState(false);
  const link = useMutation({
    mutationFn: (body: EdgeLinkRequest) => client.link(body),
    onSuccess: (next) => queryClient.setQueryData(kioskKeys.link, next),
  });
  const urlOk = URL_LIKE.test(centralUrl.trim());
  const code = nodeCode.trim().toUpperCase();
  const nodeOk = EDGE_CODE_PATTERN.test(code);
  const linkOk = normalizeEdgeLinkCode(linkCode) !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!urlOk || !nodeOk || !linkOk || link.isPending) return;
    link.mutate({ centralUrl: centralUrl.trim(), nodeCode: code, linkCode: linkCode.trim() });
  };

  return (
    <CenteredScreen>
      <form className="space-y-5" onSubmit={submit} noValidate>
        <div className="flex items-center gap-3">
          <BrandMark className="size-12 text-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('posKiosk.link.title')}</h1>
            <p className="text-[0.8125rem] text-muted-foreground">{t('posKiosk.link.hint')}</p>
          </div>
        </div>
        {state.rejected ? (
          <KioskAlert tone="warning">{t('posKiosk.link.rejected')}</KioskAlert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="link-url" className="text-[0.9375rem]">
            {t('posKiosk.link.centralUrl')}
          </Label>
          <Input
            id="link-url"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            className="h-12 font-mono text-lg md:text-lg"
            placeholder={t('posKiosk.link.centralUrlPlaceholder')}
            value={centralUrl}
            aria-invalid={tried && !urlOk}
            aria-describedby={tried && !urlOk ? 'link-url-error' : undefined}
            onChange={(event) => setCentralUrl(event.target.value)}
          />
          {tried && !urlOk ? (
            <p id="link-url-error" className="text-sm text-destructive">
              {t('posKiosk.link.centralUrlInvalid')}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-node" className="text-[0.9375rem]">
            {t('posKiosk.link.nodeCode')}
          </Label>
          <Input
            id="link-node"
            autoComplete="off"
            spellCheck={false}
            className="h-12 font-mono text-lg uppercase md:text-lg"
            placeholder={t('posKiosk.link.nodeCodePlaceholder')}
            value={nodeCode}
            disabled={state.rejected && state.nodeCode !== null}
            aria-invalid={tried && !nodeOk}
            aria-describedby={tried && !nodeOk ? 'link-node-error' : undefined}
            onChange={(event) => setNodeCode(event.target.value)}
          />
          {tried && !nodeOk ? (
            <p id="link-node-error" className="text-sm text-destructive">
              {t('posKiosk.link.nodeCodeInvalid')}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-code" className="text-[0.9375rem]">
            {t('posKiosk.link.linkCode')}
          </Label>
          <Input
            id="link-code"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={9}
            className="h-12 font-mono text-lg tracking-[0.2em] uppercase placeholder:font-sans placeholder:tracking-normal md:text-lg"
            placeholder={t('posKiosk.link.linkCodePlaceholder')}
            value={linkCode}
            aria-invalid={tried && !linkOk}
            aria-describedby={tried && !linkOk ? 'link-code-error' : undefined}
            onChange={(event) => setLinkCode(event.target.value)}
          />
          {tried && !linkOk ? (
            <p id="link-code-error" className="text-sm text-destructive">
              {t('posKiosk.link.linkCodeInvalid')}
            </p>
          ) : null}
        </div>
        {link.isError ? <KioskAlert>{problemText(link.error)}</KioskAlert> : null}
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={link.isPending}>
          {link.isPending ? t('posKiosk.link.pending') : t('posKiosk.link.submit')}
        </Button>
      </form>
    </CenteredScreen>
  );
}
