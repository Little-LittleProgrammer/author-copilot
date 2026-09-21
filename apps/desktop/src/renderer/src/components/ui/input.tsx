import type { ComponentProps, JSX } from "react";

import { cn } from "@/lib/utils.js";

export function Input({
  className,
  type,
  ...props
}: ComponentProps<"input">): JSX.Element {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
