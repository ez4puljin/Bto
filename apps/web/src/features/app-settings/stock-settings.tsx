import { CUSTOMER_STOCK_DISPLAYS, type CustomerStockDisplay } from '@tugeel/shared/sales';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FormFooter, FormSection } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWarehouses } from '@/features/identity/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type AppStockWarehouses, requestOf, useAppSettings, useSaveAppSettings } from './api';

/** Which app's list: «Bto300» (`customer`) or the staff app (`staff`). */
export type StockAppList = keyof AppStockWarehouses;

const ascending = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);
const sameIds = (a: readonly number[], b: readonly number[]) => {
  const x = ascending(a);
  const y = ascending(b);
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

/**
 * «Үлдэгдэл харуулах байршил» (ADR-0173): the warehouses whose stock an app shows. A product shows
 * only its home warehouse's stock; one whose home is not ticked shows as «Дууссан» and cannot be
 * ordered; nothing ticked counts every warehouse. On «Bto300»'s tab the card also chooses words or
 * the number. Saved with the row, the other app's list sent back as read.
 */
export function AppStockCard({ app }: { app: StockAppList }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const settings = useAppSettings();
  const warehouses = useWarehouses();
  const save = useSaveAppSettings();
  const action = useAction();
  const data = settings.data;
  // What the user changed; null shows the row as stored (and follows a refetch).
  const [draftIds, setDraftIds] = useState<number[] | null>(null);
  const [draftDisplay, setDraftDisplay] = useState<CustomerStockDisplay | null>(null);

  // Transit warehouses hold nothing to sell and inactive ones are refused by the server.
  const options = useMemo(
    () =>
      (warehouses.data ?? [])
        .filter((warehouse) => warehouse.kind !== 'TRANSIT' && warehouse.status === 'ACTIVE')
        .map((warehouse) => ({
          value: warehouse.id,
          label: `${warehouse.code} · ${warehouse.name}`,
        })),
    [warehouses.data],
  );
  const storedIds = data?.stockWarehouses[app] ?? [];
  const storedDisplay = data?.customerStockDisplay ?? 'WORDS';
  const ids = draftIds ?? storedIds;
  const display = draftDisplay ?? storedDisplay;
  const customer = app === 'customer';
  const dirty = !sameIds(ids, storedIds) || (customer && display !== storedDisplay);
  const editable = canManage && !save.isPending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!data) return;
    const live = new Set(options.map((option) => option.value));
    const ok = await action.run(() =>
      save.mutateAsync({
        ...requestOf(data),
        stockWarehouses: {
          ...data.stockWarehouses,
          [app]: ascending(ids.filter((id) => live.has(id))),
        },
        ...(customer ? { customerStockDisplay: display } : {}),
      }),
    );
    if (ok) {
      setDraftIds(null);
      setDraftDisplay(null);
      toast.success(t('appSettings.products.stock.saved'));
    }
  };

  return (
    <Card role="region" aria-label={t('appSettings.products.stock.title')}>
      <CardHeader>
        <CardTitle>{t('appSettings.products.stock.title')}</CardTitle>
        <CardDescription>{t('appSettings.products.stock.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
        <ProblemAlert problem={problemFromError(warehouses.error)} onRetry={warehouses.refetch} />
        {settings.isPending || warehouses.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {data && warehouses.isSuccess ? (
          <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
            <FormSection
              title={t('appSettings.products.stock.warehouses')}
              description={t('appSettings.products.stock.blockedHint')}
            >
              <div
                role="group"
                aria-label={t('appSettings.products.stock.warehouses')}
                className="flex flex-col gap-2 px-3.5 py-3"
              >
                {options.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('appSettings.products.stock.noWarehouses')}
                  </p>
                ) : (
                  <CheckboxGroup
                    name={`app-stock-${app}`}
                    options={options}
                    value={ids}
                    disabled={!editable}
                    onChange={setDraftIds}
                  />
                )}
                {ids.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('appSettings.products.stock.allNow')}
                  </p>
                ) : null}
              </div>
            </FormSection>
            {customer ? (
              <FormSection
                title={t('appSettings.products.stock.display')}
                description={t('appSettings.products.stock.displayHint')}
              >
                <div
                  role="radiogroup"
                  aria-label={t('appSettings.products.stock.display')}
                  className="divide-y divide-border/80"
                >
                  {CUSTOMER_STOCK_DISPLAYS.map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2.5 px-3.5 py-3 text-sm has-disabled:cursor-default"
                    >
                      <input
                        type="radio"
                        name="app-stock-display"
                        className="size-4 accent-primary"
                        value={value}
                        checked={display === value}
                        disabled={!editable}
                        onChange={() => setDraftDisplay(value)}
                      />
                      {t(`appSettings.products.stock.displays.${value}`)}
                    </label>
                  ))}
                </div>
              </FormSection>
            ) : null}
            <ProblemAlert problem={action.problem} />
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
        ) : null}
      </CardContent>
    </Card>
  );
}
