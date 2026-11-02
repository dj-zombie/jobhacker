import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Drop-in replacement for shadcn's button.tsx. Same exports and props;
  restyled to the JobHacker tokens. `default` is the brand primary.
*/
const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,color,box-shadow,transform,filter,opacity] duration-150 ease-out-quint",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-linear-to-b from-brand to-brand-lo text-white shadow-button ring-1 ring-inset ring-white/10 hover:brightness-110",
        secondary:
          "border border-line-2 bg-surface-3 text-fg shadow-hairline hover:border-line-3 hover:bg-surface-4",
        outline: "border border-line-2 bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg",
        ghost: "text-fg-2 hover:bg-surface-3 hover:text-fg",
        positive: "bg-strong-wash text-strong ring-1 ring-inset ring-strong/25 hover:bg-strong/20",
        destructive: "bg-danger-wash text-danger ring-1 ring-inset ring-danger/25 hover:bg-danger/20",
        link: "h-auto px-0 text-brand-hi underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 max-md:min-h-10 max-md:min-w-10 gap-1.5 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 max-md:min-h-10 rounded-md px-3 text-sm",
        lg: "h-10 rounded-lg px-4 text-base",
        icon: "size-8 max-md:min-h-10 max-md:min-w-10 rounded-md",
        "icon-sm": "size-7 max-md:min-h-10 max-md:min-w-10 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
