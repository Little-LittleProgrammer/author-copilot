import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps, JSX } from "react";

import { cn } from "@/lib/utils.js";

export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>): JSX.Element {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
