import type { ReactNode } from "react";
import { cn } from "./card";

export function Table({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("overflow-hidden rounded-[var(--radius-md)] border border-border", className)}
    >
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/70">{children}</tbody>;
}

export function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={cn("h-11", className)}>{children}</tr>;
}

export function TH({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2 font-medium", className)}>{children}</th>;
}

export function TD({
  children,
  className = "",
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-2 align-middle", className)}>
      {children}
    </td>
  );
}
