import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[#eef2f4] text-[#425a66]",
  success: "bg-[#e4f2ec] text-[#225b44]",
  warning: "bg-[#fff1d7] text-[#80520f]",
  danger: "bg-[#fbe9e9] text-[#9f3030]",
  info: "bg-[#e9f0f6] text-[#355873]",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold leading-tight",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
