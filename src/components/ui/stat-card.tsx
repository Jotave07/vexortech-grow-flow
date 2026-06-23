import * as React from "react";
import { cn } from "@/lib/utils";
import { TONES, type Tone } from "@/lib/tone-constants";

export interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: Tone;
  subtitle?: string;
  className?: string;
}

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ icon, label, value, tone, subtitle, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-all duration-200 hover:shadow-panel",
        className,
      )}
      {...props}
    >
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", TONES[tone])}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-bold tracking-tight">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  ),
);
StatCard.displayName = "StatCard";
