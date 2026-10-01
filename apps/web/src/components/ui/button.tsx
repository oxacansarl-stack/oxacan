import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** One primary action per screen. */
        primary: 'bg-graphite text-chalk hover:bg-graphite-3',
        ghost: 'bg-paper border-line text-ink hover:bg-paper-2 hover:border-[#c9c5ba]',
        quiet: 'text-ink-2 hover:bg-chalk',
        danger: 'bg-bad text-white hover:brightness-110',
        /** Reserved for the destructive choice inside a confirmation dialog. */
        dangerOutline: 'bg-paper border-line text-bad hover:bg-bad-bg',
      },
      size: {
        default: 'h-[34px] px-3 text-[13.5px]',
        sm: 'h-7 px-[9px] text-[13px]',
        icon: 'h-[34px] w-[34px] px-0',
        iconSm: 'h-7 w-7 px-0',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * A disabled button cannot be focused, so it can never explain itself. Where an action is
 * blocked by a business rule, pass `blockedReason` instead of `disabled`: the button stays
 * focusable and announces why (offer submission, §7.9).
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps & { blockedReason?: string }>(
  ({ className, variant, size, asChild = false, blockedReason, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const blocked = Boolean(blockedReason);
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : 'button'}
        aria-disabled={blocked || props.disabled || undefined}
        title={blockedReason ?? props.title}
        onClick={blocked ? (e) => e.preventDefault() : onClick}
        className={cn(
          buttonVariants({ variant, size }),
          blocked && 'cursor-not-allowed bg-[#b9bab9] text-[#f4f4f2] hover:bg-[#b9bab9]',
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
