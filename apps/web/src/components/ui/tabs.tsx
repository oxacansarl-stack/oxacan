import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      '-mb-px flex items-center gap-[7px] whitespace-nowrap border-b-2 border-transparent px-2.5 py-3 text-[13.5px] text-muted transition-colors',
      'hover:text-ink data-[state=active]:border-graphite data-[state=active]:font-medium data-[state=active]:text-ink',
      '[&_svg]:size-4',
      className,
    )}
    {...props}
  >
    {children}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

/** The count inside a tab, e.g. "Lignes 5". */
export function TabCount({ children }: { children: React.ReactNode }) {
  return <span className="tnum rounded-full bg-chalk px-1.5 text-[11.5px] text-muted">{children}</span>;
}

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-none', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';
