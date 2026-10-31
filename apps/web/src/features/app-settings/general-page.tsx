import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type AppSettings, requestOf, useAppSettings, useSaveAppSettings } from './api';

const NAME_MAX = 40;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** The apps' own blue, shown in the preview while no colour is set. */
const DEFAULT_COLOR = '#1e6fd9';
const DEFAULT_NAME = 'Bto300';

/**
 * «Апп» → «Ерөнхий» (ADR-0127, customer.home.manage): the apps' name and primary colour, read by
 * both apps on their next version; empty = the apps' built-in ones. A colour picker and a hex field
 * kept in step, a preview band under them.
 */
export function AppGeneralPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const settings = useAppSettings();
  return (
    <div>
      <PageHeader
        title={t('appSettings.general.title')}
        description={t('appSettings.general.description')}
      />
      <Card role="region" aria-label={t('appSettings.general.section')}>
        <CardHeader>
          <CardTitle>{t('appSettings.general.section')}</CardTitle>
          <CardDescription>{t('appSettings.general.versionHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
          {settings.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {settings.data ? <BrandingForm settings={settings.data} canManage={canManage} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BrandingForm({ settings, canManage }: { settings: AppSettings; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useSaveAppSettings();
  const action = useAction();
  const [name, setName] = useState(settings.appName ?? '');
  const [color, setColor] = useState(settings.appColor ?? '');
  const [errors, setErrors] = useState<{
    name?: 'validation.tooLong';
    color?: 'validation.color';
  }>({});
  useEffect(() => {
    setName(settings.appName ?? '');
    setColor(settings.appColor ?? '');
  }, [settings.appName, settings.appColor]);

  const trimmedName = name.trim();
  const trimmedColor = color.trim();
  const previewColor = HEX_COLOR.test(trimmedColor) ? trimmedColor : DEFAULT_COLOR;
  const dirty =
    trimmedName !== (settings.appName ?? '') || trimmedColor !== (settings.appColor ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if ([...trimmedName].length > NAME_MAX) next.name = 'validation.tooLong';
    if (trimmedColor !== '' && !HEX_COLOR.test(trimmedColor)) next.color = 'validation.color';
    setErrors(next);
    if (next.name || next.color) return;
    const ok = await action.run(() =>
      save.mutateAsync({
        ...requestOf(settings),
        appName: trimmedName === '' ? null : trimmedName,
        appColor: trimmedColor === '' ? null : trimmedColor.toUpperCase(),
      }),
    );
    if (ok) toast.success(t('appSettings.general.saved'));
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
      <FormSection>
        <FormRow
          label={t('appSettings.general.name')}
          htmlFor="app-name"
          hint={t('appSettings.general.nameHint')}
          error={errors.name}
        >
          <Input
            id="app-name"
            autoComplete="off"
            maxLength={NAME_MAX}
            placeholder={DEFAULT_NAME}
            className="sm:w-80"
            value={name}
            disabled={!canManage}
            onChange={(event) => {
              setErrors((prev) => ({ ...prev, name: undefined }));
              setName(event.target.value);
            }}
          />
        </FormRow>
        <FormRow
          label={t('appSettings.general.color')}
          htmlFor="app-color"
          hint={t('appSettings.general.colorHint')}
          error={errors.color}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t('appSettings.general.colorPicker')}
              className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-60"
              value={previewColor}
              disabled={!canManage}
              onChange={(event) => {
                setErrors((prev) => ({ ...prev, color: undefined }));
                setColor(event.target.value.toUpperCase());
              }}
            />
            <Input
              id="app-color"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_COLOR.toUpperCase()}
              className="font-mono sm:w-36"
              value={color}
              disabled={!canManage}
              onChange={(event) => {
                setErrors((prev) => ({ ...prev, color: undefined }));
                setColor(event.target.value);
              }}
            />
          </div>
        </FormRow>
        <FormRow label={t('appSettings.general.preview')} htmlFor="app-preview">
          <div
            id="app-preview"
            data-testid="app-preview"
            className="flex h-12 items-center rounded-lg px-4 text-base font-semibold text-white"
            style={{ backgroundColor: previewColor }}
          >
            {trimmedName === '' ? DEFAULT_NAME : trimmedName}
          </div>
        </FormRow>
      </FormSection>
      {canManage ? (
        <FormFooter>
          <Button type="submit" pending={save.isPending} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </FormFooter>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">{t('appSettings.readOnly')}</p>
      )}
    </form>
  );
}
