import { SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block w-full rounded-[var(--bd-radius-sm)] border border-[var(--bd-line)] bg-[var(--bd-surface)] px-3 py-2 text-sm text-[var(--bd-ink)]",
        "transition-shadow duration-150",
        "focus:border-[var(--bd-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-teal)]/20",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
