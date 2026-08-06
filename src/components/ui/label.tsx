import { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-sm font-medium text-slate-800", className)} {...props} />;
}
