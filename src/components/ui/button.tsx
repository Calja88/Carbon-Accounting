import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[var(--bd-teal)] text-white shadow-[var(--bd-shadow)] hover:bg-[var(--bd-teal-strong)] disabled:bg-slate-300 disabled:shadow-none",
  secondary:
    "bg-[var(--bd-surface)] text-[var(--bd-ink)] border border-[var(--bd-line)] hover:bg-[#eff4f4] disabled:bg-slate-50 disabled:text-slate-400",
  ghost: "bg-transparent text-[var(--bd-muted)] hover:bg-[#eff4f4] hover:text-[var(--bd-ink)]",
  danger: "bg-red-700 text-white shadow-[var(--bd-shadow)] hover:bg-red-800 disabled:bg-red-300",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs min-h-9 px-3 py-1.5 gap-1.5",
  md: "text-xs min-h-10 px-4 py-2.5 gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-[var(--bd-radius-sm)] font-semibold transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bd-focus)] focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-70",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
