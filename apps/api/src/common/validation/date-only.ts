import { isIsoDate } from '@tugeel/shared/time';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** A real calendar day, written as YYYY-MM-DD, without a time or timezone suffix. */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target, property) => {
    registerDecorator({
      name: 'isDate',
      target: target.constructor,
      propertyName: String(property),
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isIsoDate(value),
        defaultMessage: () => '$property must be a real date in YYYY-MM-DD format',
      },
    });
  };
}
