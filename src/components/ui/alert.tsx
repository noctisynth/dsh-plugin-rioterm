import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/cn.ts';

const alertVariants = cva(
  'rio:box-border rio:min-w-0 rio:rounded-md rio:border rio:border-solid rio:bg-background rio:px-3 rio:py-2 rio:text-sm rio:wrap-anywhere',
  {
    variants: {
      variant: {
        default: 'rio:border-border rio:text-foreground',
        destructive: 'rio:border-destructive rio:text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type DivProps = React.ComponentPropsWithoutRef<'div'>;

export function Alert({
  className,
  variant,
  role = 'alert',
  ...props
}: DivProps & VariantProps<typeof alertVariants>): React.ReactElement {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({
  className,
  ...props
}: DivProps): React.ReactElement {
  return (
    <div
      data-slot="alert-title"
      className={cn('rio:min-w-0 rio:max-w-full rio:font-medium', className)}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: DivProps): React.ReactElement {
  return (
    <div
      data-slot="alert-description"
      className={cn('rio:text-xs rio:text-muted-foreground', className)}
      {...props}
    />
  );
}
