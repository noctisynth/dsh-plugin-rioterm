import * as SelectPrimitive from '@radix-ui/react-select';
import * as React from 'react';
import { cn } from '../../lib/cn.ts';

// shadcn/ui source-component composition; Radix owns interaction and focus.
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

function Chevron({ up = false }: { up?: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="rio:size-4 rio:shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    className={cn(
      'rio:box-border rio:flex rio:h-10 rio:w-full rio:min-w-0 rio:items-center rio:justify-between rio:gap-2 rio:rounded-settings',
      'rio:cursor-pointer rio:appearance-none rio:border rio:border-solid rio:border-border rio:bg-muted rio:px-3 rio:text-sm rio:text-foreground rio:[font-family:inherit] rio:text-left',
      'rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2 rio:disabled:cursor-not-allowed rio:disabled:opacity-50 rio:data-[placeholder]:text-muted-foreground rio:[&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <Chevron />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
  (
    { className, children, position = 'popper', sideOffset = 4, ...props },
    ref,
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        data-rio-ui="select"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'rio:relative rio:z-[1100] rio:box-border rio:flex rio:max-h-[min(20rem,var(--radix-select-content-available-height))] rio:min-w-32 rio:flex-col rio:overflow-hidden rio:rounded-settings',
          'rio:border rio:border-solid rio:border-border rio:bg-muted rio:text-foreground rio:shadow-md rio:[font-family:inherit]',
          position === 'popper' &&
            'rio:min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton
          data-slot="select-scroll-up-button"
          className="rio:flex rio:shrink-0 rio:cursor-default rio:items-center rio:justify-center rio:py-1"
        >
          <Chevron up />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          data-slot="select-viewport"
          className="rio:box-border rio:min-h-0 rio:w-full rio:flex-1 rio:overflow-x-hidden rio:overflow-y-auto rio:p-1"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton
          data-slot="select-scroll-down-button"
          className="rio:flex rio:shrink-0 rio:cursor-default rio:items-center rio:justify-center rio:py-1"
        >
          <Chevron />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-slot="select-item"
    className={cn(
      'rio:relative rio:box-border rio:flex rio:w-full rio:cursor-default rio:items-center rio:rounded-md rio:py-2 rio:pr-8 rio:pl-3 rio:text-sm rio:outline-none rio:select-none',
      'rio:focus:bg-accent rio:focus:text-accent-foreground rio:data-[highlighted]:bg-accent rio:data-[highlighted]:text-accent-foreground rio:data-[disabled]:pointer-events-none rio:data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator
      data-slot="select-item-indicator"
      className="rio:absolute rio:right-2 rio:flex rio:size-4 rio:items-center rio:justify-center"
    >
      <svg
        aria-hidden="true"
        className="rio:size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12 4 4L19 6" />
      </svg>
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';
