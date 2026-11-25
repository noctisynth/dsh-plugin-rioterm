import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/cn.ts';

const inputVariants = cva(
  [
    'rio:box-border rio:w-full rio:min-w-0 rio:appearance-none rio:rounded-sm',
    'rio:border rio:border-solid rio:border-border rio:bg-background rio:text-foreground rio:[font-family:inherit]',
    'rio:focus-visible:outline-1 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:-outline-offset-1 rio:disabled:cursor-not-allowed rio:disabled:opacity-50',
  ],
  {
    variants: {
      size: {
        default: 'rio:h-9 rio:px-3 rio:text-sm',
        sm: 'rio:h-7 rio:px-2 rio:text-xs',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> &
  VariantProps<typeof inputVariants>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      data-slot="input"
      type={type}
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
