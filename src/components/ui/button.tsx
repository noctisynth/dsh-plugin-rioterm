import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/cn.ts';

const buttonVariants = cva(
  [
    'rio:box-border rio:inline-flex rio:min-w-0 rio:max-w-full rio:items-center rio:justify-center rio:rounded-md',
    'rio:cursor-pointer rio:appearance-none rio:border rio:border-solid rio:[font-family:inherit] rio:font-medium rio:whitespace-normal rio:wrap-anywhere',
    'rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2 rio:disabled:pointer-events-none rio:disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        default:
          'rio:border-transparent rio:bg-primary rio:text-primary-foreground rio:hover:bg-primary-hover',
        outline:
          'rio:border-border rio:bg-background rio:text-foreground rio:hover:bg-accent rio:hover:text-accent-foreground',
      },
      size: {
        default: 'rio:min-h-9 rio:px-3 rio:py-1.5 rio:text-sm',
        sm: 'rio:min-h-7 rio:px-2.5 rio:py-1 rio:text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps): React.ReactElement {
  return (
    <button
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
