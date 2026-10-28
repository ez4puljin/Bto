import { TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { modulePath, type VisibleModule, visibleModules } from '@/app/nav-items';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCustomerAppAttention } from '@/features/customer-app/api';
import { InboxList } from '@/features/notifications/inbox';
import { formatUbToday } from '@/lib/dayjs';
import { formatCount } from '@/lib/money';
import { AttentionRows } from './attention-tiles';

/**
 * «Нүүр» (ADR-0042, ADR-0114 after the owner's erxes example), a centred column: today's date, the
 * greeting and one line; for people who set up the boards, a warning while the customer app's
 * orders have no stage to land on (ADR-0079 #5); then two cards side by side — «Анхаарах», the
 * work waiting for this person (ADR-0047 #7), and «Мэдэгдэл», the newest lines of the bell — and
 * the permitted modules as tiles, each opening its own page, with the assistant and «Систем» under
 * «Хэрэгсэл». The shortcuts and the recent pages live in the Ctrl/⌘+K search.
 */
export function HomePage() {
  const { t } = useTranslation();
  const state = useAuthState();
  const permissions = useMemo(
    () => (state.status === 'authenticated' ? state.me.permissions : []),
    [state],
  );
  const fullName = state.status === 'authenticated' ? state.me.fullName : '';
  // Mongolian names put the given name last: «Агуулахын Дорж» is greeted as Дорж.
  const name = fullName.trim().split(/\s+/u).at(-1) ?? fullName;
  const modules = useMemo(() => visibleModules(permissions), [permissions]);
  const business = modules.filter((module) => !module.tool);
  const tools = modules.filter((module) => module.tool);
  const greeting = t('home.greeting', { name });

  useEffect(() => {
    document.title = `${t('nav.home')} · ${t('app.name')}`;
  }, [t]);

  return (
    <div className="mx-auto flex max-w-[61rem] flex-col gap-5 pt-4">
      <div>
        <p className="text-[13px] text-muted-foreground">{formatUbToday()}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-tight">
          {greeting}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('home.subtitle')}</p>
      </div>
      <CustomerAppWarning enabled={permissions.includes('sales.boards.manage')} />
      <div className="grid gap-5 md:grid-cols-2">
        <HomeCard id="home-attention" title={t('home.attention.title')}>
          <AttentionRows permissions={permissions} />
        </HomeCard>
        <HomeCard id="home-inbox" title={t('shell.notifications')}>
          <InboxList />
        </HomeCard>
      </div>
      {business.length > 0 ? (
        <HomeCard id="home-modules" title={t('home.modules')}>
          <ModuleGrid modules={business} />
        </HomeCard>
      ) : null}
      {tools.length > 0 ? (
        <HomeCard id="home-tools" title={t('home.tools')}>
          <ModuleGrid modules={tools} />
        </HomeCard>
      ) : null}
    </div>
  );
}

/** A white card with a heading row, as on the erxes home (ADR-0114). */
function HomeCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]"
    >
      <h2 id={id} className="border-b border-border/80 px-4 py-3 text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ModuleGrid({ modules }: { modules: readonly VisibleModule[] }) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-4">
      {modules.map((module) => (
        <li key={module.key}>
          <Link
            to={modulePath(module.key)}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent/70"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-link">
              <module.icon aria-hidden className="size-[18px]" />
            </span>
            <span className="min-w-0 truncate">{t(module.label)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stores use «Bto300» but no stage takes the CUSTOMER_APP channel (ADR-0079 #5): their orders are
 * refused until the boards' «Сувгийн тохиргоо» names a stage without an action. Only for people who
 * set up the boards; nothing while loading, after an error or when all is well.
 */
function CustomerAppWarning({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const attention = useCustomerAppAttention(enabled);
  const data = attention.data;
  if (!enabled || !data || data.activeAccounts === 0 || data.ordersOpen) return null;
  return (
    <Alert className="border-transparent bg-warning-soft shadow-none!">
      <TriangleAlert aria-hidden className="text-warning" />
      <AlertTitle className="text-warning">{t('home.customerApp.warning')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1 text-warning">
        <span>{t('home.customerApp.hint', { n: formatCount(data.activeAccounts) })}</span>
        <Link to="/sales/boards/settings" className="self-start font-medium">
          {t('home.customerApp.open')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
