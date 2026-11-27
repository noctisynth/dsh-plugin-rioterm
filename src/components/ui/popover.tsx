import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';
import { cn } from '../../lib/cn.ts';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

// Own only the portalled content; never put the host document into Rio's scope.
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    {
      className,
      align = 'start',
      sideOffset = 8,
      collisionPadding = 12,
      onKeyDown,
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        data-rio-ui="popover"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'rio:z-[1100] rio:box-border rio:w-72 rio:max-w-[calc(100vw-2rem)] rio:max-h-[var(--radix-popover-content-available-height)] rio:overflow-y-auto rio:rounded-settings',
          'rio:border rio:border-solid rio:border-border rio:bg-muted rio:p-3 rio:text-sm rio:text-foreground rio:shadow-md rio:outline-none rio:[font-family:inherit]',
          className,
        )}
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          // The host modal's document-level Tab trap cannot see this portal.
          // Keep native Tab/FocusScope looping, but do not invoke that outer trap.
          // Escape remains Radix's document-capture dismissal, not a custom trap.
          if (event.key === 'Tab') event.stopPropagation();
        }}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';
