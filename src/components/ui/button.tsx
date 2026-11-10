import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-slate-900 text-white hover:bg-slate-800',
        outline: 'border border-slate-300 bg-white hover:bg-slate-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
/** shadcn/ui 방식의 조합 가능한 버튼 기본 요소. */
export function Button({
  className,
  variant,
  asChild,
  ...props
}: ComponentProps<'button'> & {
  variant?: 'default' | 'outline';
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant }), 'h-9 px-4', className)} {...props} />;
}
