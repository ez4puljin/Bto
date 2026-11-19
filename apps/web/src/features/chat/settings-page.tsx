import { CHAT_LIMITS, CHAT_TEXT_KEYS, type ChatTextKey } from '@tugeel/shared/chat';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type ChatSettings, useChatSettings, useUpdateChatSettings } from './api';

function SettingsForm({ settings }: { settings: ChatSettings }) {
  const { t } = useTranslation();
  const update = useUpdateChatSettings();
  const action = useAction();
  const [values, setValues] = useState<Record<ChatTextKey, string>>({
    greeting: settings.greeting ?? '',
    deliveryText: settings.deliveryText ?? '',
    hoursText: settings.hoursText ?? '',
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await update.mutateAsync({
        greeting: values.greeting.trim() || null,
        deliveryText: values.deliveryText.trim() || null,
        hoursText: values.hoursText.trim() || null,
      });
      toast.success(t('chat.web.settings.saved'));
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <FormSection>
        {CHAT_TEXT_KEYS.map((key) => (
          <FormRow
            key={key}
            label={t(`chat.web.settings.${key}`)}
            htmlFor={`chat-text-${key}`}
            hint={t('chat.web.settings.hint')}
          >
            <Textarea
              id={`chat-text-${key}`}
              rows={4}
              maxLength={CHAT_LIMITS.textMax}
              value={values[key]}
              placeholder={settings.defaults[key]}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [key]: event.target.value }))
              }
            />
          </FormRow>
        ))}
      </FormSection>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button asChild variant="outline">
          <Link to="/chat">{t('common.cancel')}</Link>
        </Button>
        <Button type="submit" pending={update.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

/** «Ботын бичвэр»: the three texts the chat bot says; an empty one means the default. */
export function ChatSettingsPage() {
  const { t } = useTranslation();
  const settings = useChatSettings();
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('chat.web.settings.title')}
        description={t('chat.web.settings.description')}
        crumbs={[{ label: t('chat.web.title'), to: '/chat' }]}
      />
      <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
      {settings.data ? <SettingsForm settings={settings.data} /> : null}
    </div>
  );
}
