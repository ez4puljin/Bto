import { Camera, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { Combobox } from '@/components/combobox';
import { DateInput, TimeInput } from '@/components/date-input';
import { SegmentedControl } from '@/components/list';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cropToJpeg } from '@/lib/image-resize';
import { uploadFile } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { Avatar } from '../hr-kit';
import {
  AUDIENCE_MODES,
  type MomentDraft,
  type useAudience,
  useWorkingStaff,
} from './community-helpers';

/*
 * Pieces the community pages share (ADR-0146): the audience of a message or a poll, its picture, a
 * moment in Ulaanbaatar and a share bar.
 */

/** A picture in the staff app: cut to one shape, under the file kind's size. */
const PICTURE_SIZE = { width: 1200, height: 675 } as const;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/* ------------------------------------------------------------------ people */

/**
 * Many employees: the chosen ones as chips, a combobox adding one more. It stays a pick-one control
 * because the list is searched by name, division and position, and a chip takes one person off.
 */
export function PeoplePicker(props: {
  label: string;
  value: readonly number[];
  onChange: (value: number[]) => void;
}) {
  const { t } = useTranslation();
  const working = useWorkingStaff();
  const chosen = useMemo(
    () =>
      props.value.map((userId) => ({
        userId,
        fullName: working.find((row) => row.userId === userId)?.fullName ?? String(userId),
      })),
    [props.value, working],
  );
  const options = useMemo(
    () =>
      working
        .filter((row) => !props.value.includes(row.userId))
        .map((row) => ({
          value: String(row.userId),
          label: row.fullName,
          hint: row.divisionName ?? undefined,
          keys: row.position ? [row.position] : undefined,
        })),
    [working, props.value],
  );
  return (
    <div className="flex flex-col gap-2">
      <Combobox
        aria-label={props.label}
        className="w-full"
        value=""
        options={options}
        emptyLabel={t('hr.community.audience.add')}
        onChange={(value) => {
          if (value) props.onChange([...props.value, Number(value)]);
        }}
      />
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((person) => (
            <li
              key={person.userId}
              className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-0.5 pl-2.5 text-[0.8125rem] font-medium text-secondary-foreground"
            >
              {person.fullName}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="rounded-full text-secondary-foreground hover:bg-secondary-hover"
                aria-label={t('hr.community.audience.remove', { name: person.fullName })}
                title={t('hr.community.audience.remove', { name: person.fullName })}
                onClick={() =>
                  props.onChange(props.value.filter((userId) => userId !== person.userId))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AudienceField(props: {
  audience: ReturnType<typeof useAudience>;
  showMissing: boolean;
}) {
  const { t } = useTranslation();
  const { audience } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t('hr.community.audience.label')}</Label>
      <div className="flex flex-col items-start gap-2">
        <SegmentedControl
          name={t('hr.community.audience.label')}
          options={AUDIENCE_MODES}
          value={audience.mode}
          label={(mode) => t(`hr.community.audience.modes.${mode}`)}
          onChange={audience.setMode}
        />
        {audience.mode === 'CHOSEN' ? (
          <div className="w-full">
            <PeoplePicker
              label={t('hr.community.audience.people')}
              value={audience.ids}
              onChange={audience.setIds}
            />
          </div>
        ) : null}
        {props.showMissing && audience.missing ? (
          <p role="alert" className="text-sm text-destructive">
            {t('hr.community.audience.missing')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- picture */

/** The picture of a message or a poll, uploaded as soon as it is chosen. */
export function PictureField(props: {
  label: string;
  onChange: (fileId: number | null) => void;
  /** Tells the form a picture is still on its way. */
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const choose = async (file: File) => {
    setFailed(false);
    setUploading(true);
    props.onBusy(true);
    try {
      const blob = await cropToJpeg(file, PICTURE_SIZE);
      const fileId = await uploadFile(api, 'hr.message_image', blob);
      setPreview(URL.createObjectURL(blob));
      props.onChange(fileId);
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
      props.onBusy(false);
    }
  };
  const remove = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    props.onChange(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        {preview ? (
          <img
            src={preview}
            alt=""
            aria-hidden
            className="h-16 w-28 rounded-lg bg-secondary object-cover"
          />
        ) : null}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label={props.label}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void choose(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          pending={uploading}
          onClick={() => input.current?.click()}
        >
          <Camera />
          {preview ? t('hr.community.picture.change') : t('hr.community.picture.pick')}
        </Button>
        {preview ? (
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            <Trash2 />
            {t('hr.community.picture.remove')}
          </Button>
        ) : null}
      </div>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          {t('validation.imageUnreadable')}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ moment */

export function MomentField(props: {
  id: string;
  label: string;
  value: MomentDraft;
  onChange: (value: MomentDraft) => void;
  required?: boolean;
  min?: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${props.id}-date`}>{props.label}</Label>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <DateInput
          id={`${props.id}-date`}
          required={props.required}
          min={props.min}
          value={props.value.date}
          onChange={(date) => props.onChange({ ...props.value, date })}
        />
        <TimeInput
          id={`${props.id}-time`}
          aria-label={t('hr.community.momentTime', { label: props.label })}
          required
          value={props.value.time}
          onChange={(time) => props.onChange({ ...props.value, time })}
        />
      </div>
      {props.error ? (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ switch */

/** An on/off setting of a form: the switch on its label's line, a hint under it. */
export function SettingSwitch(props: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{props.hint}</p> : null}
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
    </div>
  );
}

/* --------------------------------------------------------------------- bar */

/** A share as a thin bar; the figures are written beside it by the caller. */
export function ShareBar(props: { value: number; total: number; className?: string }) {
  const percent = props.total <= 0 ? 0 : Math.min(100, (props.value / props.total) * 100);
  return (
    <div
      aria-hidden
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-fill', props.className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-apple"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** A person's photo and name on one line. */
export function PersonLine(props: { name: string; photoUrl?: string | null; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', props.className)}>
      <Avatar name={props.name} src={props.photoUrl} className="size-7 text-[0.6875rem]" />
      <span className="truncate font-medium">{props.name}</span>
    </span>
  );
}
