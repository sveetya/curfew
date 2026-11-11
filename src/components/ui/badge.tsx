import type { HTMLAttributes } from "react";
import { cn } from "./card";

type Tone = "neutral" | "brand" | "warn" | "bad" | "ok";

const tones: Record<Tone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  brand: "border-primary/35 bg-primary/15 text-foreground",
  warn: "border-secondary/40 bg-secondary/15 text-secondary",
  bad: "border-destructive/40 bg-destructive/15 text-destructive",
  ok: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
};

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] leading-none tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
