import * as React from "react";
import { cn } from "@/lib/utils";

type IconSize = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<IconSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  xl: "h-6 w-6",
};

export interface IconProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: IconSize;
  className?: string;
  strokeWidth?: number;
}

export const Icon = React.memo(
  ({ icon: IconComponent, size = "md", className, strokeWidth = 1.5 }: IconProps) => (
    <IconComponent
      className={cn(sizeMap[size], className)}
      strokeWidth={strokeWidth}
    />
  ),
);
Icon.displayName = "Icon";
