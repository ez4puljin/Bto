import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * A plain <select> drawn like the inputs; works with react-hook-form's register(). The `filter`
 * variant is the pill of a list's filter bar (ADR-0042): tinted blue while it narrows the list,
 * i.e. while its value is not the "all" option ('') — or as `active` says.
 */
export function NativeSelect({
  className,
  variant = 'default',
  active,
  ...props
}: ComponentProps<'select'> & { variant?: 'default' | 'filter'; active?: boolean }) {
  const narrowing = active ?? (props.value !== undefined && props.value !== '');
  return (
    <select
      data-active={variant === 'filter' && narrowing ? 'true' : undefined}
      className={cn(
        'native-select outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'filter'
          ? 'h-8.5 w-auto max-w-64 truncate rounded-full border border-border bg-background pl-3 text-[0.8125rem] font-medium shadow-control hover:bg-accent data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground'
          : 'h-10 w-full rounded-lg border border-input bg-background pl-3 text-base shadow-control md:text-sm',
        className,
      )}
      {...props}
    />
  );
}
