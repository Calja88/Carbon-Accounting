import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400",
        "focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100",
        "disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
