import { STAGE_ACTIONS, STAGE_RIGHTS } from '@tugeel/shared/sales';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StageInput } from './pipelines-api';
import { useRoleOptions } from './role-options';

const EMPTY_STAGE: StageInput = {
  name: '',
  action: 'NONE',
  printPickList: false,
  printDeliveryNote: false,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
};

/**
 * A stage's settings inside the pipeline sheet (ADR-0056 #1): the name, what arriving does, which
 * documents print, who may see, edit and move. Nothing is sent until the pipeline is saved.
 */
export function StageDialog({
  stage,
  onSave,
}: {
  stage: StageInput | null;
  onSave: (stage: StageInput) => void;
}) {
  const { t } = useTranslation();
  const options = useRoleOptions();
  const [form, setForm] = useState<StageInput>(stage ?? EMPTY_STAGE);
  const patch = (fields: Partial<StageInput>) => setForm((current) => ({ ...current, ...fields }));
  return (
    <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {stage ? t('sales.boards.editStage') : t('sales.boards.newStage')}
        </DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.name.trim()) onSave({ ...form, name: form.name.trim() });
        }}
      >
        <FormField label={t('sales.boards.name')} htmlFor="stage-name">
          <Input
            id="stage-name"
            autoFocus
            value={form.name}
            maxLength={80}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FormField>
        <FormField
          label={t('sales.boards.action')}
          htmlFor="stage-action"
          hint={t(`sales.stageActionHints.${form.action}`)}
        >
          <NativeSelect
            id="stage-action"
            value={form.action}
            onChange={(event) => {
              const value = STAGE_ACTIONS.find((entry) => entry === event.target.value);
              if (value) patch({ action: value });
            }}
          >
            {STAGE_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.stageActions.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('sales.boards.prints')}</legend>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stage-print-pick"
              checked={form.printPickList}
              onCheckedChange={(next) => patch({ printPickList: next === true })}
            />
            <Label htmlFor="stage-print-pick" className="font-normal">
              {t('sales.printKinds.PICK_LIST')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stage-print-note"
              checked={form.printDeliveryNote}
              onCheckedChange={(next) => patch({ printDeliveryNote: next === true })}
            />
            <Label htmlFor="stage-print-note" className="font-normal">
              {t('sales.printKinds.DELIVERY_NOTE')}
            </Label>
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('sales.boards.stageRolesHint')}</p>
        {STAGE_RIGHTS.map((right) => (
          <fieldset key={right} className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t(`sales.stageRights.${right}`)}</legend>
            <CheckboxGroup
              name={`stage-${right.toLowerCase()}`}
              options={options}
              value={form.roles[right]}
              onChange={(value) => patch({ roles: { ...form.roles, [right]: value } })}
            />
          </fieldset>
        ))}
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button type="submit" disabled={!form.name.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
