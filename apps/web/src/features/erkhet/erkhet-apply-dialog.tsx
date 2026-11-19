import type { ProblemDetails } from '@tugeel/api-client';
import { nameKey } from '@tugeel/shared/text';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCategories } from '@/features/catalog/api';
import { categoryTree } from '@/features/catalog/category-tree';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { problemFromError } from '@/lib/problem';

/** What the dialog asks before products are added or priced from Erkhet (ADR-0222). */
export interface ErkhetApplyChosen {
  categoryId?: number;
  profileId: number;
}

const parseId = (value: string): number | undefined =>
  value ? Number.parseInt(value, 10) : undefined;

/**
 * «Bto-д нэмэх» and «Үнийг тааруулах» for products (ADR-0222, ADR-0223): each product takes the
 * category and the price profile erxes gives it; the two fields are what a product erxes does not
 * settle takes instead: a category (adding only, optional: without it such products are refused)
 * and a price profile, «Үндсэн» proposed. What the products take from Erkhet, and what is filled
 * later on their page, is said above the fields.
 */
export function ErkhetApplyDialog(props: {
  action: 'addProducts' | 'priceProducts';
  count: number;
  pending: boolean;
  problem: ProblemDetails | null;
  onSubmit: (chosen: ErkhetApplyChosen) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const adding = props.action === 'addProducts';
  const categories = useCategories();
  const profiles = usePriceProfileChoices();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const live = useMemo(
    () => (profiles.data ?? []).filter((profile) => profile.status === 'ACTIVE'),
    [profiles.data],
  );
  const proposed = useMemo(() => {
    const main = nameKey(t('erkhet.apply.defaultProfile'));
    return (
      live.find((profile) => nameKey(profile.name) === main)?.id ??
      (live.length === 1 ? live[0]?.id : undefined)
    );
  }, [live, t]);
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [chosenProfile, setChosenProfile] = useState<number | undefined>();
  const profileId = chosenProfile ?? proposed;
  const ready = profileId !== undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || profileId === undefined) return;
    props.onSubmit(adding ? { categoryId, profileId } : { profileId });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t(`erkhet.apply.button.${props.action}`)}</DialogTitle>
          <DialogDescription>
            {t(`erkhet.apply.confirm.${props.action}`, { count: props.count })}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={props.problem ?? problemFromError(categories.error ?? profiles.error)}
        />
        <form id="erkhet-apply" className="grid gap-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">{t('erkhet.apply.fromErxes')}</p>
          {adding ? (
            <FormField label={t('erkhet.apply.category')} htmlFor="erkhet-apply-category">
              <NativeSelect
                id="erkhet-apply-category"
                value={categoryId === undefined ? '' : String(categoryId)}
                onChange={(event) => setCategoryId(parseId(event.target.value))}
              >
                <option value="">{t('erkhet.apply.noCategory')}</option>
                {tree.map((node) => (
                  <option key={node.category.id} value={String(node.category.id)}>
                    {node.path}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField label={t('erkhet.apply.profile')} htmlFor="erkhet-apply-profile">
            <NativeSelect
              id="erkhet-apply-profile"
              value={profileId === undefined ? '' : String(profileId)}
              onChange={(event) => setChosenProfile(parseId(event.target.value))}
            >
              <option value="">{t('catalog.products.bulk.chooseProfile')}</option>
              {live.map((profile) => (
                <option key={profile.id} value={String(profile.id)}>
                  {profile.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="erkhet-apply"
            pending={props.pending}
            disabled={!ready || props.count === 0}
          >
            {t('erkhet.apply.confirmLabel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
