"use client";

import type * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

/* shadcn-compatible Slider: brand-filled range, glowing thumb. */
function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-4">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-linear-to-r from-brand-lo to-brand-hi" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          // biome-ignore lint/suspicious/noArrayIndexKey: thumbs are positional; Radix tracks them by index
          key={i}
          className={cn(
            "block size-4 rounded-full border-2 border-brand-hi bg-fg shadow-glow outline-none",
            "transition-[transform,box-shadow] duration-150 ease-out-quint hover:scale-110 hover:shadow-neon active:scale-95",
            "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uv-hi",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
