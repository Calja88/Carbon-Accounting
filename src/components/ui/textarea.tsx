import { TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "block w-full rounded-[var(--bd-radius-sm)] border border-[var(--bd-line)] bg-[var(--bd-surface)] px-3 py-2 text-sm text-[var(--bd-ink)] placeholder:text-slate-400",
        "transition-shadow duration-150",
        "focus:border-[var(--bd-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-teal)]/20",
        "disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
