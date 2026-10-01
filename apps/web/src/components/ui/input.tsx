import * as React from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-md border border-line bg-paper text-ink placeholder:text-muted ' +
  'focus:border-copper focus:outline-none focus:ring-[3px] focus:ring-copper/15 ' +
  'disabled:cursor-not-allowed disabled:bg-paper-2 disabled:text-muted';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(fieldBase, 'h-9 px-2.5 text-[13.5px]', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-20 px-2.5 py-2 text-[13.5px]', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/**
 * Native select: it is keyboard- and screen-reader-correct everywhere, including on the
 * phones the site roles use, and needs no popup layer.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-9 pl-2.5 pr-7 text-[13.5px]', className)} {...props} />
  ),
);
Select.displayName = 'Select';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-[13px] font-medium text-ink-2', className)} {...props} />
  ),
);
Label.displayName = 'Label';

/** Label, control and (when the field is invalid) its message, wired together for assistive tech. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-bad"> *</span> : null}
      </Label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Search box with a leading icon, used above every list. */
export const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }
>(({ className, icon, ...props }, ref) => (
  <div className="relative w-full max-w-[280px]">
    {icon ? (
      <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
        {icon}
      </span>
    ) : null}
    <Input ref={ref} type="search" className={cn(icon && 'pl-8', className)} {...props} />
  </div>
));
SearchInput.displayName = 'SearchInput';
