import type { ProblemDetails } from '@tugeel/api-client';
import { ImagePlus, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { resizeToPng } from '@/lib/image-resize';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import {
  type PictureCheck,
  pictureCheckFailureOf,
  usePictureSettings,
  usePictureSettingsMutations,
} from './ai-settings-api';

const ACCEPT = 'image/png,image/jpeg,image/webp';
/** The logo is drawn about 220 px wide on a picture; 512 keeps it sharp and small. */
const LOGO_MAX_SIDE = 512;

function CheckLine({ check }: { check: PictureCheck }) {
  const { t } = useTranslation();
  if (!check.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`aiSettings.picture.failed.${pictureCheckFailureOf(check)}`, { status: check.status })}
      </p>
    );
  }
  return (
    <p role="status" className="flex flex-wrap gap-x-4 text-sm text-success">
      <span>{t('aiSettings.picture.testOk')}</span>
      {check.credits !== null ? (
        <span>{t('aiSettings.picture.credits', { credits: check.credits })}</span>
      ) : null}
      {check.freeCalls !== null ? (
        <span>{t('aiSettings.picture.freeCalls', { count: check.freeCalls })}</span>
      ) : null}
    </p>
  );
}

/**
 * «Тохиргоо → AI → Барааны зураг» (ADR-0198): the key of the background service, typed by the
 * owner and never shown again, with a free check that also tells the credit left; and the
 * company's logo drawn in the top-left corner of the pictures «AI ашиглах» makes.
 */
export function PictureSettingsCard() {
  const { t } = useTranslation();
  const api = useApiClient();
  const settings = usePictureSettings();
  const mutations = usePictureSettingsMutations();
  const [key, setKey] = useState('');
  const [logoProblem, setLogoProblem] = useState<'unsupported' | null>(null);
  const [uploadProblem, setUploadProblem] = useState<ProblemDetails | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const view = settings.data;
  const typed = key.trim();

  const saveKey = async () => {
    const saved = await settle(mutations.update.mutateAsync({ apiKey: typed }));
    if (saved) {
      setKey('');
      toast.success(t('common.saved'));
    }
  };
  const removeKey = async () => {
    if (await settle(mutations.update.mutateAsync({ apiKey: null }))) {
      toast.success(t('aiSettings.picture.keyRemoved'));
    }
  };
  const chooseLogo = async (chosen: File | undefined) => {
    if (!chosen) return;
    setLogoProblem(null);
    setUploadProblem(null);
    setUploading(true);
    try {
      let logo: Blob;
      try {
        logo = await resizeToPng(chosen, LOGO_MAX_SIDE);
      } catch {
        setLogoProblem('unsupported');
        return;
      }
      const stampFileId = await uploadFile(api, 'ai.picture_stamp', logo);
      if (await settle(mutations.update.mutateAsync({ stampFileId }))) {
        toast.success(t('common.saved'));
      }
    } catch (error) {
      setUploadProblem(problemFromError(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card role="region" aria-labelledby="ai-picture-title">
      <CardHeader>
        <CardTitle id="ai-picture-title">{t('aiSettings.picture.title')}</CardTitle>
        <CardDescription>{t('aiSettings.picture.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ProblemAlert
          problem={problemFromError(settings.error ?? mutations.update.error)}
          onRetry={settings.error ? settings.refetch : undefined}
        />
        {view ? (
          <>
            {!view.secretReady ? (
              <Alert variant="destructive">
                <AlertDescription>{t('aiSettings.connection.secretMissing')}</AlertDescription>
              </Alert>
            ) : null}
            {view.keyUnreadable ? (
              <Alert variant="destructive">
                <AlertDescription>{t('aiSettings.connection.keyUnreadable')}</AlertDescription>
              </Alert>
            ) : null}
            <FormField
              label={t('aiSettings.picture.key')}
              htmlFor="ai-picture-key"
              hint={
                view.keyHint
                  ? `${t('aiSettings.picture.keySaved', { hint: view.keyHint })} ${t('aiSettings.picture.keyKeep')}`
                  : t('aiSettings.picture.keyHelp')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="ai-picture-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="sm:w-80"
                  disabled={!view.secretReady}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={typed.length < 8 || mutations.update.isPending}
                  onClick={() => void saveKey()}
                >
                  {t('common.save')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutations.test.isPending || (!typed && !view.keyHint)}
                  onClick={() => mutations.test.mutate(typed || undefined)}
                >
                  {mutations.test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                  {mutations.test.isPending
                    ? t('aiSettings.picture.testing')
                    : t('aiSettings.picture.test')}
                </Button>
                {view.keyHint ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={mutations.update.isPending}
                    onClick={() => void removeKey()}
                  >
                    <Trash2 />
                    {t('aiSettings.picture.keyRemove')}
                  </Button>
                ) : null}
              </div>
            </FormField>
            <ProblemAlert problem={problemFromError(mutations.test.error)} />
            {mutations.test.data ? <CheckLine check={mutations.test.data} /> : null}

            <FormField
              label={t('aiSettings.picture.logo')}
              htmlFor="ai-picture-logo"
              hint={t('aiSettings.picture.logoHelp')}
            >
              <div className="flex flex-wrap items-center gap-3">
                {view.stampUrl ? (
                  <img
                    src={view.stampUrl}
                    alt={t('aiSettings.picture.logoAlt')}
                    className="h-16 max-w-48 rounded-lg bg-fill object-contain p-1.5 ring-1 ring-black/[0.06]"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t('aiSettings.picture.logoNone')}
                  </span>
                )}
                <input
                  ref={file}
                  id="ai-picture-logo"
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(event) => {
                    const [chosen] = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    void chooseLogo(chosen);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading || mutations.update.isPending}
                  onClick={() => file.current?.click()}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                  {view.stampUrl
                    ? t('aiSettings.picture.logoChange')
                    : t('aiSettings.picture.logoChoose')}
                </Button>
                {view.stampUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={mutations.update.isPending}
                    onClick={() => void settle(mutations.update.mutateAsync({ stampFileId: null }))}
                  >
                    <Trash2 />
                    {t('aiSettings.picture.logoRemove')}
                  </Button>
                ) : null}
              </div>
            </FormField>
            <ProblemAlert problem={uploadProblem} />
            {logoProblem ? (
              <p role="alert" className="text-sm text-destructive">
                {t('aiSettings.picture.logoUnsupported')}
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
