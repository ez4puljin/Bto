import {
  EDUCATION_LEVELS,
  EMPLOYEE_GENDERS,
  type EducationLevel,
  type EmployeeGender,
  ENGAGEMENT_LIMITS,
  JOB_LEVELS,
  type JobLevel,
  MARITAL_STATUSES,
  type MaritalStatus,
} from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/date-input';
import { DetailCard, FieldList } from '@/components/detail';
import { FormField, FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useEngagementMutations } from '../engagement-api';
import type { HrStaff } from '../workforce-api';

interface ChildDraft {
  key: number;
  name: string;
  gender: EmployeeGender | '';
  birthDate: string;
}

function DetailsForm(props: { staff: HrStaff; onClose: () => void }) {
  const { t } = useTranslation();
  const { staff } = props;
  const mutations = useEngagementMutations();
  const action = useAction();
  const [birthDate, setBirthDate] = useState(staff.birthDate ?? '');
  const [gender, setGender] = useState<EmployeeGender | ''>(staff.gender ?? '');
  const [education, setEducation] = useState<EducationLevel | ''>(staff.education ?? '');
  const [marital, setMarital] = useState<MaritalStatus | ''>(staff.maritalStatus ?? '');
  const [district, setDistrict] = useState(staff.district ?? '');
  const [jobLevel, setJobLevel] = useState<JobLevel | ''>(staff.jobLevel ?? '');
  const [children, setChildren] = useState<ChildDraft[]>(() =>
    staff.children.map((child, key) => ({
      key,
      name: child.name ?? '',
      gender: child.gender ?? '',
      birthDate: child.birthDate,
    })),
  );
  const [nextKey, setNextKey] = useState(staff.children.length);
  const [tried, setTried] = useState(false);
  const today = businessDate();
  const change = (key: number, fields: Partial<ChildDraft>) =>
    setChildren((prev) => prev.map((row) => (row.key === key ? { ...row, ...fields } : row)));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (children.some((child) => child.birthDate === '')) return;
    const ok = await action.run(() =>
      mutations.saveDetails.mutateAsync({
        userId: staff.userId,
        birthDate: birthDate || null,
        gender: gender || null,
        education: education || null,
        maritalStatus: marital || null,
        district: district.trim() || null,
        jobLevel: jobLevel || null,
        children: children.map((child) => ({
          name: child.name.trim() || null,
          gender: child.gender || null,
          birthDate: child.birthDate,
        })),
      }),
    );
    if (ok) {
      toast.success(t('hr.community.details.saved'));
      props.onClose();
    }
  };
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('hr.community.details.birthDate')} htmlFor="details-birth">
          <DateInput id="details-birth" max={today} value={birthDate} onChange={setBirthDate} />
        </FormField>
        <FormField label={t('hr.community.details.gender')} htmlFor="details-gender">
          <NativeSelect
            id="details-gender"
            value={gender}
            onChange={(event) => setGender(event.target.value as EmployeeGender | '')}
          >
            <option value="">{t('hr.community.details.notChosen')}</option>
            {EMPLOYEE_GENDERS.map((value) => (
              <option key={value} value={value}>
                {t(`hr.genders.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.community.details.education')} htmlFor="details-education">
          <NativeSelect
            id="details-education"
            value={education}
            onChange={(event) => setEducation(event.target.value as EducationLevel | '')}
          >
            <option value="">{t('hr.community.details.notChosen')}</option>
            {EDUCATION_LEVELS.map((value) => (
              <option key={value} value={value}>
                {t(`hr.community.details.educations.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.community.details.maritalStatus')} htmlFor="details-marital">
          <NativeSelect
            id="details-marital"
            value={marital}
            onChange={(event) => setMarital(event.target.value as MaritalStatus | '')}
          >
            <option value="">{t('hr.community.details.notChosen')}</option>
            {MARITAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`hr.community.details.maritalStatuses.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('hr.community.details.district')} htmlFor="details-district">
          <Input
            id="details-district"
            maxLength={ENGAGEMENT_LIMITS.maxDistrict}
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
          />
        </FormField>
        <FormField label={t('hr.community.details.jobLevel')} htmlFor="details-level">
          <NativeSelect
            id="details-level"
            value={jobLevel}
            onChange={(event) => setJobLevel(event.target.value as JobLevel | '')}
          >
            <option value="">{t('hr.community.details.notChosen')}</option>
            {JOB_LEVELS.map((value) => (
              <option key={value} value={value}>
                {t(`hr.community.details.jobLevels.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('hr.community.details.children')}</h3>
        {children.map((child, index) => {
          const number = index + 1;
          const id = `details-child-${child.key}`;
          return (
            <div
              key={child.key}
              role="group"
              aria-label={t('hr.community.details.childNumber', { number })}
              className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]"
            >
              <FormField label={t('hr.community.details.childName')} htmlFor={`${id}-name`}>
                <Input
                  id={`${id}-name`}
                  maxLength={ENGAGEMENT_LIMITS.maxCategory}
                  value={child.name}
                  onChange={(event) => change(child.key, { name: event.target.value })}
                />
              </FormField>
              <FormField label={t('hr.community.details.childGender')} htmlFor={`${id}-gender`}>
                <NativeSelect
                  id={`${id}-gender`}
                  value={child.gender}
                  onChange={(event) =>
                    change(child.key, { gender: event.target.value as EmployeeGender | '' })
                  }
                >
                  <option value="">{t('hr.community.details.notChosen')}</option>
                  {EMPLOYEE_GENDERS.map((value) => (
                    <option key={value} value={value}>
                      {t(`hr.genders.${value}`)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t('hr.community.details.childBirthDate')} htmlFor={`${id}-birth`}>
                <DateInput
                  id={`${id}-birth`}
                  required
                  max={today}
                  value={child.birthDate}
                  onChange={(birth) => change(child.key, { birthDate: birth })}
                />
              </FormField>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="mb-1"
                aria-label={t('hr.community.details.removeChild', { number })}
                title={t('hr.community.details.removeChild', { number })}
                onClick={() => setChildren((prev) => prev.filter((row) => row.key !== child.key))}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
        {tried && children.some((child) => child.birthDate === '') ? (
          <p role="alert" className="text-sm text-destructive">
            {t('hr.community.details.childDateMissing')}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={children.length >= ENGAGEMENT_LIMITS.maxChildren}
            onClick={() => {
              setChildren((prev) => [
                ...prev,
                { key: nextKey, name: '', gender: '', birthDate: '' },
              ]);
              setNextKey((key) => key + 1);
            }}
          >
            <Plus />
            {t('hr.community.details.addChild')}
          </Button>
        </div>
      </div>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" pending={mutations.saveDetails.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

/** «Нэмэлт мэдээлэл» (ADR-0146): what the dashboards count and the calendar's birthdays read. */
export function StaffDetailsCard({ staff, canManage }: { staff: HrStaff; canManage: boolean }) {
  const { t } = useTranslation();
  return (
    <DetailCard
      title={t('hr.community.details.title')}
      canEdit={canManage}
      view={
        <FieldList
          items={[
            { label: t('hr.community.details.birthDate'), value: staff.birthDate },
            {
              label: t('hr.community.details.gender'),
              value: staff.gender ? t(`hr.genders.${staff.gender}`) : null,
            },
            {
              label: t('hr.community.details.education'),
              value: staff.education
                ? t(`hr.community.details.educations.${staff.education}`)
                : null,
            },
            {
              label: t('hr.community.details.maritalStatus'),
              value: staff.maritalStatus
                ? t(`hr.community.details.maritalStatuses.${staff.maritalStatus}`)
                : null,
            },
            { label: t('hr.community.details.district'), value: staff.district },
            {
              label: t('hr.community.details.jobLevel'),
              value: staff.jobLevel ? t(`hr.community.details.jobLevels.${staff.jobLevel}`) : null,
            },
            {
              label: t('hr.community.details.children'),
              value:
                staff.children.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {staff.children.map((child, index) => (
                      <li key={index}>
                        {child.name
                          ? t('hr.community.details.childLine', {
                              name: child.name,
                              birthDate: child.birthDate,
                            })
                          : child.birthDate}
                      </li>
                    ))}
                  </ul>
                ) : null,
            },
          ]}
        />
      }
      edit={(close) => <DetailsForm staff={staff} onClose={close} />}
    />
  );
}
