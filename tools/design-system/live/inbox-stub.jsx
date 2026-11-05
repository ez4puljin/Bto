import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Stands in for features/notifications/inbox.tsx, whose bell reads the server: same button, empty.
export function InboxBell() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('shell.notifications')}
          title={t('shell.notifications')}
        >
          <Bell />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t('shell.notifications')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <p className="px-2 py-4 text-[0.8125rem] leading-snug text-muted-foreground">
          {t('shell.noNotifications')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
