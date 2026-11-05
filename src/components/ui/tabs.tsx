"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/*
  shadcn-compatible Tabs. The active trigger gets an underline that slides
  between tabs; pass the current value to TabsList so it can track it.
*/
const Tabs = TabsPrimitive.Root;

const TabsContext = React.createContext<{ value?: string; id: string }>({ id: "tabs" });

function TabsList({
  className,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { value?: string }) {
  const id = React.useId();
  return (
    <TabsContext.Provider value={{ value, id }}>
      <TabsPrimitive.List
        className={cn("relative flex items-center gap-1 border-b border-line", className)}
        {...props}
      />
    </TabsContext.Provider>
  );
}

function TabsTrigger({ className, value, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = React.useContext(TabsContext);
  const active = ctx.value === value;
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative -mb-px inline-flex h-9 max-md:min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-fg-3 outline-none",
        "transition-colors duration-150 hover:text-fg-2 data-[state=active]:text-fg",
        "focus-visible:rounded-md focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
        className,
      )}
      {...props}
    >
      {children}
      {active ? (
        <motion.span
          layoutId={`${ctx.id}-underline`}
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-hi shadow-neon"
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
        />
      ) : null}
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none data-[state=active]:animate-rise-in", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
