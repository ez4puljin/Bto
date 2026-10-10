import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface CheckboxOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** A list of checkboxes bound to an array of selected values (roles, scopes, permissions). */
export function CheckboxGroup<T extends string | number>(props: {
  name: string;
  options: CheckboxOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {props.options.map((option) => {
        const id = `${props.name}-${String(option.value)}`;
        const checked = props.value.includes(option.value);
        return (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              disabled={props.disabled || option.disabled}
              onCheckedChange={(next) =>
                props.onChange(
                  next === true
                    ? [...props.value, option.value]
                    : props.value.filter((item) => item !== option.value),
                )
              }
            />
            <Label htmlFor={id} className="font-normal">
              {option.label}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
