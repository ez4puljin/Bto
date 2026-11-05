import { Link } from 'react-router';
// Through the app's file: a bare 'cn' from here would be the older copy hoisted to the root.
import { cn } from '@/lib/utils';

// The code has no tile component: these are the exact classes of features/home/module-page.tsx
// (`page`, `action`) and features/home/home-page.tsx (`home`).
const CARD =
  'flex min-h-14 items-center gap-3 rounded-xl bg-card px-3.5 py-2 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-popover active:scale-[0.98]';
const LINK = {
  page: CARD,
  action: CARD,
  home: 'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-[background-color,transform] duration-200 ease-apple hover:bg-accent/70 active:scale-[0.98]',
};
const ICON = {
  page: 'grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-link',
  action: 'grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-link',
  home: 'grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-link transition-transform duration-200 ease-apple group-hover:scale-105',
};
const LABEL = {
  page: 'line-clamp-2 min-w-0 text-sm leading-snug font-medium',
  action: 'line-clamp-2 min-w-0 text-sm leading-snug font-medium',
  home: 'min-w-0 truncate',
};

export function ModuleTile({ to, icon: Icon, label, variant = 'page', className }) {
  return (
    <Link to={to} className={cn(LINK[variant], className)}>
      <span className={ICON[variant]}>
        <Icon aria-hidden className="size-[1.125rem]" />
      </span>
      <span className={LABEL[variant]}>{label}</span>
    </Link>
  );
}
