import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

export function AppShell() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t('app.name');
  }, [t]);
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <span className="text-lg font-semibold">{t('app.name')}</span>
          <nav>
            <NavLink
              to="/system/status"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {t('nav.systemStatus')}
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
