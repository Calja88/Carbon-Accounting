import { SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900",
        "focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
