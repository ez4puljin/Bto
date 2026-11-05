import {
  EMPLOYEE_GENDERS,
  EMPLOYMENT_TYPES,
  type EmployeeGender,
  type EmploymentType,
  LEFT_REASON_KINDS,
  type LeftReasonKind,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { Camera, Trash2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { DateInput } from '@/components/date-input';
import { DialogFormFooter, FormField, FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { randomUuid } from '@/lib/uuid';
import { cropToJpeg } from '@/lib/image-resize';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { Avatar } from './hr-kit';
import {
  type HrStaff,
  useDivisions,
  useWorkforceMutations,
  useWorkSchedules,
} from './workforce-api';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const PHOTO_SIZE = { width: 400, height: 400 } as const;
const MIN_PASSWORD = 8;

interface Draft {
  lastName: string;
  firstName: string;
  phone: string;
  position: string;
  divisionId: string;
  employmentType: EmploymentType;
  gender: EmployeeGender | '';
  employedOn: string;
  scheduleId: string;
  password: string;
}

/** A user who never had a card holds one name: «Овог Нэр» splits on its first space. */
function namesOf(staff: HrStaff): { lastName: string; firstName: string } {
  if (staff.firstName !== null) {
    return { lastName: staff.lastName ?? '', firstName: staff.firstName };
  }
  const [last, ...rest] = staff.fullName.trim().split(/\s+/);
  return rest.length > 0
    ? { lastName: last ?? '', firstName: rest.join(' ') }
    : { lastName: '', firstName: last ?? '' };
}

const draftOf = (staff: HrStaff | null): Draft => ({
  ...(staff ? namesOf(staff) : { lastName: '', firstName: '' }),
  phone: staff?.phone?.replace(/^\+976/, '') ?? '',
  position: staff?.position ?? '',
  divisionId: staff?.divisionId === null || !staff ? '' : String(staff.divisionId),
  employmentType: staff?.employmentType ?? 'PERMANENT',
  gender: staff?.gender ?? '',
  employedOn: staff?.employedOn ?? '',
  scheduleId: staff?.scheduleId === null || !staff ? '' : String(staff.scheduleId),
  password: '',
});

type Errors = Partial<Record<'lastName' | 'firstName' | 'phone' | 'password', string>>;

/**
 * The employee's card as a form (ADR-0144, ADR-0145): the names, the phone they sign in with, the
 * position, division, schedule; a new employee also gets the first password. A dialog when
 * registering (`staff` null), in the page's card when editing.
 */
export function StaffForm(props: {
  staff: HrStaff | null;
  onCancel: () => void;
  onSaved: (userId: number) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const divisions = useDivisions();
  const schedules = useWorkSchedules();
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(props.staff));
  const [errors, setErrors] = useState<Errors>({});
  const [key, setKey] = useState(randomUuid);
  const staff = props.staff;

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };
  /** «Хадгалаад шинэ» (ADR-0151) keeps the division, schedule and kind of employment. */
  const save = async (another: boolean) => {
    const next: Errors = {};
    if (draft.lastName.trim() === '') next.lastName = 'validation.required';
    if (draft.firstName.trim() === '') next.firstName = 'validation.required';
    if (!/^\d{8}$/.test(draft.phone.trim())) next.phone = 'validation.phone';
    if (!staff && draft.password.length < MIN_PASSWORD) {
      next.password = draft.password === '' ? 'validation.required' : 'validation.passwordTooShort';
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const body = {
      lastName: draft.lastName.trim(),
      firstName: draft.firstName.trim(),
      phone: draft.phone.trim(),
      position: draft.position.trim() || null,
      divisionId: draft.divisionId === '' ? null : Number(draft.divisionId),
      employmentType: draft.employmentType,
      gender: draft.gender === '' ? null : draft.gender,
      employedOn: draft.employedOn || null,
      scheduleId: draft.scheduleId === '' ? null : Number(draft.scheduleId),
    };
    if (staff) {
      const ok = await action.run(() =>
        mutations.updateStaff.mutateAsync({ userId: staff.userId, ...body, password: null }),
      );
      if (ok) {
        toast.success(t('hr.staff.dialog.saved'));
        props.onSaved(staff.userId);
      }
      return;
    }
    let created: HrStaff | null = null;
    const ok = await action.run(async () => {
      created = await mutations.createStaff.mutateAsync({ key, ...body, password: draft.password });
    });
    if (ok && created) {
      toast.success(t('hr.staff.dialog.created'));
      if (another) {
        formRef.current?.reset();
        setKey(randomUuid());
        setDraft((prev) => ({
          ...draftOf(null),
          divisionId: prev.divisionId,
          scheduleId: prev.scheduleId,
          employmentType: prev.employmentType,
          employedOn: prev.employedOn,
        }));
        setErrors({});
        return;
      }
      props.onSaved((created as HrStaff).userId);
    }
  };

  const pending = mutations.createStaff.isPending || mutations.updateStaff.isPending;
  return (
    <form ref={formRef} className="flex flex-col gap-4" noValidate onSubmit={submit}>
      <ProblemAlert problem={action.problem} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={t('hr.staff.dialog.lastName')}
          htmlFor="staff-last"
          error={errors.lastName}
        >
          <Input
            id="staff-last"
            maxLength={WORKFORCE_LIMITS.maxName}
            value={draft.lastName}
            onChange={(event) => set('lastName', event.target.value)}
          />
        </FormField>
        <FormField
          label={t('hr.staff.dialog.firstName')}
          htmlFor="staff-first"
          error={errors.firstName}
        >
          <Input
            id="staff-first"
            maxLength={WORKFORCE_LIMITS.maxName}
            value={draft.firstName}
            onChange={(event) => set('firstName', event.target.value)}
          />
        </FormField>
        <FormField
          label={t('hr.staff.dialog.phone')}
          htmlFor="staff-phone"
          hint={t('hr.staff.dialog.phoneHint')}
          error={errors.phone}
        >
          <Input
            id="staff-phone"
            inputMode="numeric"
            maxLength={8}
            value={draft.phone}
            onChange={(event) => set('phone', event.target.value.replace(/\D/g, ''))}
          />
        </FormField>
        {staff ? null : (
          <FormField
            label={t('hr.staff.dialog.passwordNew')}
            htmlFor="staff-password"
            hint={t('hr.staff.dialog.passwordCreateHint')}
            error={errors.password}
          >
            <Input
              id="staff-password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => set('password', event.target.value)}
            />
          </FormField>
        )}
        <FormField label={t('hr.staff.dialog.position')} htmlFor="staff-position">
          <Input
            id="staff-position"
            maxLength={WORKFORCE_LIMITS.maxPosition}
            value={draft.position}
            onChange={(event) => set('position', event.target.value)}
          />
        </FormField>
        <FormField label={t('hr.staff.dialog.division')} htmlFor="staff-division">
          <NativeSelect
            id="staff-division"
            value={draft.divisionId}
            onChange={(event) => set('divisionId', event.target.value)}
          >
            <option value="">{t('hr.staff.noDivision')}</option>
            {(divisions.data ?? []).map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.staff.dialog.schedule')} htmlFor="staff-schedule">
          <NativeSelect
            id="staff-schedule"
            value={draft.scheduleId}
            onChange={(event) => set('scheduleId', event.target.value)}
          >
            <option value="">{t('hr.companySchedule')}</option>
            {(schedules.data ?? []).map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.staff.dialog.employmentType')} htmlFor="staff-type">
          <NativeSelect
            id="staff-type"
            value={draft.employmentType}
            onChange={(event) => set('employmentType', event.target.value as EmploymentType)}
          >
            {EMPLOYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`hr.employmentTypes.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.staff.dialog.gender')} htmlFor="staff-gender">
          <NativeSelect
            id="staff-gender"
            value={draft.gender}
            onChange={(event) => set('gender', event.target.value as EmployeeGender | '')}
          >
            <option value="">{t('hr.staff.dialog.noGender')}</option>
            {EMPLOYEE_GENDERS.map((value) => (
              <option key={value} value={value}>
                {t(`hr.genders.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.staff.dialog.employedOn')} htmlFor="staff-employed">
          <DateInput
            id="staff-employed"
            max={businessDate()}
            value={draft.employedOn}
            onChange={(value) => set('employedOn', value)}
          />
        </FormField>
      </div>
      {staff ? (
        <FormFooter>
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {t('common.save')}
          </Button>
        </FormFooter>
      ) : (
        <DialogFormFooter
          pending={pending}
          onCancel={props.onCancel}
          submitLabel={t('common.create')}
          onSaveAndNew={() => void save(true)}
        />
      )}
    </form>
  );
}

/** «Ажилтан нэмэх» (?new=1): the card with the first password; their page opens after saving. */
export function StaffCreateDialog(props: {
  onClose: () => void;
  onCreated: (userId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <DialogHeader>
          <DialogTitle>{t('hr.staff.dialog.createTitle')}</DialogTitle>
        </DialogHeader>
        <StaffForm staff={null} onCancel={props.onClose} onSaved={props.onCreated} />
      </DialogContent>
    </Dialog>
  );
}

/** The photo with «Зураг солих» and «Зураг арилгах», cut square in the browser. */
export function PhotoPicker({ staff, canManage }: { staff: HrStaff; canManage: boolean }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const choose = async (file: File) => {
    setFailed(false);
    setUploading(true);
    try {
      const blob = await cropToJpeg(file, PHOTO_SIZE);
      const fileId = await uploadFile(api, 'hr.employee_photo', blob);
      const ok = await action.run(() =>
        mutations.setPhoto.mutateAsync({ userId: staff.userId, fileId }),
      );
      if (ok) toast.success(t('hr.staff.dialog.photoSaved'));
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  };
  const remove = async () => {
    const ok = await action.run(() =>
      mutations.setPhoto.mutateAsync({ userId: staff.userId, fileId: null }),
    );
    if (ok) toast.success(t('hr.staff.dialog.photoRemoved'));
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={staff.fullName} src={staff.photoUrl} className="size-20 text-xl" />
      {canManage ? (
        <div className="flex flex-col gap-1.5">
          <ProblemAlert problem={action.problem} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              aria-label={t('hr.staff.dialog.photo')}
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
              onClick={() => fileInput.current?.click()}
            >
              <Camera />
              {staff.photoUrl ? t('hr.staff.dialog.photoChange') : t('hr.staff.dialog.photoPick')}
            </Button>
            {staff.photoUrl ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => void remove()}>
                <Trash2 />
                {t('hr.staff.dialog.photoRemove')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t('hr.staff.dialog.photoHint')}</p>
          {failed ? (
            <p role="alert" className="text-xs text-destructive">
              {t('validation.imageUnreadable')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * «Нууц үг солих» (owner 2026-11-05, ADR-0145): a new password given directly and told to the
 * employee, who signs in with the phone and that password. The field is shown in clear so it can be
 * read out; it is sent once and never kept here.
 */
export function ResetPasswordDialog(props: { staff: HrStaff; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(password === '' ? 'validation.required' : 'validation.passwordTooShort');
      return;
    }
    const ok = await action.run(() =>
      mutations.resetPassword.mutateAsync({ userId: props.staff.userId, password }),
    );
    if (ok) {
      toast.success(t('hr.staff.reset.done'));
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('hr.staff.reset.title')}</DialogTitle>
          <DialogDescription>
            {t('hr.staff.reset.description', { name: props.staff.fullName })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('hr.staff.reset.password')}
            htmlFor="reset-password"
            hint={t('hr.staff.reset.hint')}
            error={error}
          >
            <Input
              id="reset-password"
              autoComplete="off"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(undefined);
              }}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.resetPassword.isPending}
            onCancel={close}
            submitLabel={t('common.save')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Ажлаас гарсан»: the date and the reason; the account is closed, the history stays. */
export function LeaveDialog(props: { staff: HrStaff; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [date, setDate] = useState(businessDate());
  const [reasonKind, setReasonKind] = useState<LeftReasonKind | ''>('');
  const [reason, setReason] = useState('');
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!date) return;
    const ok = await action.run(() =>
      mutations.setLeft.mutateAsync({
        userId: props.staff.userId,
        leftOn: date,
        reason: reason.trim() || null,
        reasonKind: reasonKind || null,
      }),
    );
    if (ok) {
      toast.success(t('hr.staff.left.done'));
      close();
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('hr.staff.left.title')}</DialogTitle>
          <DialogDescription>
            {t('hr.staff.left.description', { name: props.staff.fullName })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField label={t('hr.staff.left.date')} htmlFor="left-date">
            <DateInput id="left-date" required value={date} onChange={setDate} />
          </FormField>
          <FormField label={t('hr.community.details.leftKind')} htmlFor="left-kind">
            <NativeSelect
              id="left-kind"
              value={reasonKind}
              onChange={(event) => setReasonKind(event.target.value as LeftReasonKind | '')}
            >
              <option value="">{t('hr.community.details.leftKindNone')}</option>
              {LEFT_REASON_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`hr.community.details.leftKinds.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('hr.staff.left.reason')} htmlFor="left-reason">
            <Textarea
              id="left-reason"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.setLeft.isPending}
            onCancel={close}
            submitLabel={t('hr.staff.left.confirm')}
            disabled={!date}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
