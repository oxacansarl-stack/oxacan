import { registerDecorator, ValidationOptions } from 'class-validator';
import { isIBANValid } from 'swissqrbill/utils';

/** A valid CH/LI IBAN or QR-IBAN (QR-bills only accept Swiss and Liechtenstein accounts). */
export function IsSwissIban(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isSwissIban',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid Swiss or Liechtenstein IBAN`, ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && /^(CH|LI)[0-9A-Z]{19}$/.test(value) && isIBANValid(value),
      },
    });
}
