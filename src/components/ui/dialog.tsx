"use client";

import type * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({
  className,
  children,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px]",
          "data-[state=open]:animate-fade-in",
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2",
          "rounded-xl border border-line-2 bg-surface-2 text-fg shadow-pop outline-none",
          "data-[state=open]:animate-dialog-in",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription };
